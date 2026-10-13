'use strict';
/* ====== Núcleo: utilidades, API, modais, roteador ====== */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = c => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fromCents = c => (c / 100).toFixed(2).replace('.', ',');
const toCents = v => { let s = String(v == null ? '' : v).replace(/[R$\s]/g, ''); if (!s) return 0; if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const n = Number(s); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const pad2 = n => String(n).padStart(2, '0'), pad3 = n => String(n).padStart(3, '0');
const fdt = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : '—';
const fdate = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
const todayStr = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const STATUSES = [['aberta', 'Abertas'], ['em_preparo', 'Em preparo'], ['pronta', 'Prontas'], ['finalizada', 'Finalizadas'], ['cancelada', 'Canceladas']];
const SL = { aberta: 'Aberta', em_preparo: 'Em preparo', pronta: 'Pronta', finalizada: 'Finalizada', cancelada: 'Cancelada' };
const OPEN = ['aberta', 'em_preparo', 'pronta'];
const METHOD = { dinheiro: 'Dinheiro', pix: 'PIX', cartao: 'Cartão' };
const PERM_LABEL = { comandas: 'Abrir/editar comandas', receber: 'Receber pagamentos', desconto: 'Aplicar descontos', cancelar: 'Cancelar/remover itens e estornar', caixa: 'Operar o caixa (abrir, sangria, fechar)' };
const badge = s => `<span class="badge st-${s}">${SL[s] || s}</span>`;
let ME, META;
const pages = {}, timers = [];
const can = p => ME.role === 'admin' || ME.perms.includes(p);

async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'app' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { location.reload(); throw new Error(j.error || 'Sessão expirada'); }
  if (!r.ok) throw new Error(j.error || 'Erro inesperado');
  return j;
}
const get = u => api(u), post = (u, b) => api(u, 'POST', b || {}), put = (u, b) => api(u, 'PUT', b || {}), del = (u, b) => api(u, 'DELETE', b || {});
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3200); }
const guard = async fn => { try { return await fn(); } catch (e) { toast(e.message, true); } };
function every(ms, fn) { timers.push(setInterval(fn, ms)); }

function modal(html, cls = '') {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${cls}" role="dialog"><button class="x" aria-label="Fechar">×</button><div class="mb">${html}</div></div>`;
  document.body.appendChild(ov); const m = ov.firstElementChild; m.body = $('.mb', m);
  m.set = h => { m.body.innerHTML = h; };
  m.close = () => { ov.remove(); document.body.classList.remove('printing-modal'); if (m.onclose) m.onclose(); };
  $('.x', m).onclick = () => m.close(); return m;
}
function confirmBox({ title = 'Confirmar', msg = '', reason = false, ok = 'Confirmar', danger = false }) {
  return new Promise(res => {
    const m = modal(`<h2>${esc(title)}</h2><p>${msg}</p>${reason ? '<label>Motivo (obrigatório)<input id="cr" maxlength="200" autofocus></label>' : ''}<div class="err" id="ce" style="color:var(--err)"></div><div class="acts"><button class="btn" id="cn">Voltar</button><button class="btn ${danger ? 'danger' : 'pri'}" id="cy">${esc(ok)}</button></div>`);
    let done = false; const fin = v => { if (done) return; done = true; m.close(); res(v); }; m.onclose = () => fin(null);
    $('#cn', m).onclick = () => fin(null);
    $('#cy', m).onclick = () => { if (reason) { const v = $('#cr', m).value.trim(); if (v.length < 3) { $('#ce', m).textContent = 'Informe o motivo.'; return; } fin(v); } else fin(true); };
  });
}
function printModal() { document.body.classList.add('printing-modal'); window.print(); setTimeout(() => document.body.classList.remove('printing-modal'), 300); }
function downloadCSV(name, cols, rows) {
  const cell = (v, f) => { if (v == null) return ''; if (f === 'money' && v !== '') v = (v / 100).toFixed(2).replace('.', ','); v = String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const out = [cols.map(c => cell(c[1])).join(';'), ...rows.map(r => cols.map(c => cell(r[c[0]], c[2])).join(';'))].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + out], { type: 'text/csv;charset=utf-8' })); a.download = name + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const fmtCell = (v, f) => v == null || v === '' ? '' : f === 'money' ? money(v) : f === 'int' ? Number(v).toLocaleString('pt-BR') : esc(v);

/* ====== Comandas ====== */
pages.comandas = {
  title: 'Comandas', perm: 'comandas',
  async render(el) {
    let date = todayStr(), q = '';
    el.innerHTML = `<div class="pagehead no-print"><h2>Comandas</h2><div class="toolbar"><input type="search" id="q" placeholder="Buscar nº ou cliente"><input type="date" id="dt" value="${date}"><button class="btn pri" id="new">+ Nova comanda</button></div></div><div class="board" id="board"></div>`;
    const card = r => `<div class="oc" data-id="${r.id}"><span class="t">${money(r.total)}</span><div class="n">#${pad3(r.id)}</div><div>${esc(r.customer || 'Sem nome')}</div><div class="muted small">${esc(r.seller_name)} · ${fdt(r.created_at)} · ${r.items} ${r.items === 1 ? 'item' : 'itens'}</div>${r.paid > 0 && r.status !== 'finalizada' && r.status !== 'cancelada' ? `<div class="small" style="color:var(--ok)">Pago ${money(r.paid)}</div>` : ''}</div>`;
    const load = async () => {
      const rows = await get('/api/orders?' + new URLSearchParams(q ? { q } : { date }));
      $('#board').innerHTML = STATUSES.map(([s, l]) => { const c = rows.filter(r => r.status === s); return `<div class="col"><h3>${l}<span class="cnt">${c.length}</span></h3>${c.map(card).join('') || '<div class="muted small">Nenhuma</div>'}</div>`; }).join('');
    };
    $('#board').onclick = e => { const c = e.target.closest('.oc'); if (c) guard(() => openOrder(+c.dataset.id, load)); };
    $('#q').oninput = debounce(() => { q = $('#q').value.trim(); guard(load); }, 300);
    $('#dt').onchange = () => { date = $('#dt').value || todayStr(); q = ''; $('#q').value = ''; guard(load); };
    $('#new').onclick = () => {
      const m = modal(`<h2>Nova comanda</h2><form id="nf"><label>Nome do cliente (opcional)<input id="nc" maxlength="80" autofocus></label><label>Observações (opcional)<input id="nn" maxlength="300"></label><div class="acts"><button type="button" class="btn" id="x2">Cancelar</button><button class="btn pri">Abrir comanda</button></div></form>`);
      $('#x2', m).onclick = () => m.close();
      $('#nf', m).onsubmit = e => { e.preventDefault(); guard(async () => { const r = await post('/api/orders', { customer: $('#nc', m).value, notes: $('#nn', m).value }); m.close(); await load(); openOrder(r.id, load); }); };
    };
    await load(); every(15000, () => { if (!$('.overlay')) load().catch(() => {}); });
  },
};

function itemDialog(name, addons, item) {
  return new Promise(res => {
    const sel = new Set((item ? item.addons : []).map(a => a.id));
    const m = modal(`<h2>${esc(name)}</h2><label>Quantidade<input id="iq" type="number" min="1" max="99" value="${item ? item.qty : 1}"></label>${addons.length ? `<div class="muted small" style="margin-top:8px">Adicionais</div>${addons.map(a => `<label class="chk"><input type="checkbox" value="${a.id}" ${sel.has(a.id) ? 'checked' : ''}> ${esc(a.name)} <span class="muted">+ ${money(a.price)}</span></label>`).join('')}` : ''}<label>Observações<input id="in" maxlength="200" value="${esc(item ? item.note || '' : '')}" placeholder="Ex.: sem cebola, ponto da carne…"></label><div class="acts"><button class="btn" id="ic">Cancelar</button><button class="btn pri" id="iok">${item ? 'Salvar' : 'Adicionar'}</button></div>`);
    let done = false; const fin = v => { if (done) return; done = true; m.close(); res(v); }; m.onclose = () => fin(null);
    $('#ic', m).onclick = () => fin(null);
    $('#iok', m).onclick = () => fin({ qty: Math.max(1, Math.min(99, +$('#iq', m).value || 1)), note: $('#in', m).value, addons: $$('input[type=checkbox]:checked', m).map(c => +c.value) });
  });
}

async function openOrder(id, onChange) {
  const [prods, first] = await Promise.all([get('/api/products'), get('/api/orders/' + id)]);
  let o = first, cat = 'Todos', search = '';
  const addons = prods.filter(p => p.category === 'Adicionais' && p.available);
  const m = modal('', 'wide'); m.onclose = () => onChange && onChange();
  const apply = async fn => { try { o = await fn(); draw(); } catch (e) { toast(e.message, true); } };
  function grid() {
    const list = prods.filter(p => (cat === 'Todos' || p.category === cat) && p.name.toLowerCase().includes(search.toLowerCase()));
    $('#pg', m).innerHTML = list.map(p => `<button class="pc ${p.available ? '' : 'off'}" data-p="${p.id}" ${p.available ? '' : 'disabled'}>${p.photo ? `<img src="${esc(p.photo)}" alt="">` : '<div class="ph">🍔</div>'}<div class="i"><div class="nm">${esc(p.name)}</div><div class="pr">${money(p.price)}</div>${!p.available ? '<div class="small muted">Indisponível</div>' : p.stock_control ? `<div class="small muted">Estoque: ${p.stock}</div>` : ''}</div></button>`).join('') || '<div class="muted">Nenhum produto encontrado. O administrador cadastra os produtos na aba Produtos.</div>';
  }
  function draw() {
    const editable = OPEN.includes(o.status), editItems = editable && (o.status === 'aberta' || can('cancelar'));
    const nextSt = { aberta: ['em_preparo', 'Enviar para preparo'], em_preparo: ['pronta', 'Marcar como pronta'] }[o.status];
    m.set(`<div class="ord"><div>
      <h2>Comanda #${pad3(o.id)} ${badge(o.status)}</h2>
      <div class="muted small">Cliente: <b>${esc(o.customer || '—')}</b> · Responsável: <b>${esc(o.seller_name)}</b> · Aberta em ${fdt(o.created_at)}${o.closed_at ? ` · Encerrada em ${fdt(o.closed_at)}` : ''}${o.notes ? `<br>Obs: ${esc(o.notes)}` : ''}</div>
      ${editable ? `<div class="toolbar no-print" style="margin-top:12px"><input id="ps" placeholder="Buscar produto…" value="${esc(search)}"></div><div class="chips no-print" id="cats">${['Todos', ...META.cats].map(c => `<button class="chip ${c === cat ? 'on' : ''}" data-c="${c}">${c}</button>`).join('')}</div><div class="pgrid no-print" id="pg"></div>` : `<div class="note">Comanda ${SL[o.status].toLowerCase()}${o.cancel_reason ? ` — motivo: ${esc(o.cancel_reason)} (por ${esc(o.cancelled_by_name || '')})` : ''}. Não pode mais ser alterada.</div>`}
    </div><div id="oside">
      <h3>Itens</h3><div class="items">${o.items.map(i => `<div class="it"><div><b>${i.qty}× ${esc(i.name)}</b> <span class="muted small">${money(i.unit_price)}</span>${i.addons.length ? `<small>+ ${i.addons.map(a => esc(a.name)).join(', ')}</small>` : ''}${i.note ? `<small>Obs: ${esc(i.note)}</small>` : ''}</div><div class="right nowrap"><b>${money(i.qty * (i.unit_price + i.addons_total))}</b>${editItems ? `<div class="no-print"><button class="btn sm" data-edit="${i.id}" title="Editar">✎</button> <button class="btn sm danger" data-del="${i.id}" title="Remover">✕</button></div>` : ''}</div></div>`).join('') || '<div class="muted">Nenhum item ainda.</div>'}</div>
      ${editable && !editItems && o.items.length ? '<div class="note no-print">Comanda já enviada ao preparo: só quem tem permissão de cancelamento pode alterar/remover itens existentes. Você ainda pode adicionar novos itens.</div>' : ''}
      <div class="line"><span>Subtotal</span><b>${money(o.subtotal)}</b></div>
      ${o.discount ? `<div class="line"><span>Desconto <span class="muted small">(autorizado por ${esc(o.discount_by_name || '—')})</span></span><b>− ${money(o.discount)}</b></div>` : ''}
      <div class="line big"><span>Total</span><span>${money(o.total)}</span></div>
      <div class="line"><span>Pago</span><b style="color:var(--ok)">${money(o.paid)}</b></div><div class="line"><span>Restante</span><b>${money(o.remaining)}</b></div>
      ${o.payments.length ? `<h3 style="margin-top:12px">Pagamentos</h3>${o.payments.map(p => `<div class="line small ${p.voided ? 'muted' : ''}"><span>${p.voided ? '<s>' : ''}${METHOD[p.method]} ${money(p.amount)} — recebido por ${esc(p.received_by_name)} · ${fdt(p.created_at)}${p.voided ? `</s> (estornado: ${esc(p.void_reason)})` : ''}</span>${!p.voided && can('cancelar') && o.status !== 'cancelada' ? `<button class="btn sm danger no-print" data-void="${p.id}">Estornar</button>` : ''}</div>`).join('')}` : ''}
      ${editable && o.items.length && o.remaining > 0 ? (can('receber') ? `<div class="card no-print" style="margin-top:12px"><h3>Receber pagamento</h3><div class="row2"><label>Forma<select id="pm"><option value="dinheiro">Dinheiro</option><option value="pix">PIX</option><option value="cartao">Cartão</option></select></label><label>Valor<input id="pa" inputmode="decimal" value="${fromCents(o.remaining)}"></label></div><div id="cw"><label>Valor entregue pelo cliente (para o troco)<input id="pt" inputmode="decimal"></label><div id="chg" class="small muted"></div></div><button class="btn ok" id="payb">Receber pagamento</button><div class="small muted" style="margin-top:6px">Quem recebe: <b>${esc(ME.name)}</b> (fica registrado). Pagamentos parciais/divididos são permitidos.</div></div>` : '<div class="note no-print">Seu usuário não tem permissão para receber pagamentos. Peça a um funcionário autorizado.</div>') : ''}
      <div class="acts no-print" style="justify-content:flex-start">
        <button class="btn sm" id="prt">🖨️ Imprimir</button>
        ${editable ? `<button class="btn sm" id="cust">Cliente/obs.</button>` : ''}
        ${editable && o.items.length && can('desconto') ? '<button class="btn sm" id="disc">Desconto</button>' : ''}
        ${editable && (!o.items.length || can('cancelar')) ? '<button class="btn sm danger" id="cancel">Cancelar comanda</button>' : ''}
        ${editable && nextSt ? `<button class="btn pri" data-st="${nextSt[0]}">${nextSt[1]}</button>` : ''}
        ${editable && o.items.length && o.remaining === 0 ? '<button class="btn ok" data-st="finalizada">✔ Finalizar pedido</button>' : ''}
      </div></div></div>`);
    if (editable) grid();
  }
  m.body.addEventListener('input', e => {
    if (e.target.id === 'ps') { search = e.target.value; grid(); }
    if (e.target.id === 'pt' || e.target.id === 'pa') { const t = toCents($('#pt', m).value), a = toCents($('#pa', m).value); $('#chg', m).textContent = t > 0 && a > 0 ? (t >= a ? `Troco: ${money(t - a)}` : 'Valor entregue menor que o valor a receber') : ''; }
  });
  m.body.addEventListener('change', e => { if (e.target.id === 'pm') $('#cw', m).hidden = e.target.value !== 'dinheiro'; });
  m.body.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.c) { cat = b.dataset.c; $$('#cats .chip', m).forEach(c => c.classList.toggle('on', c.dataset.c === cat)); grid(); }
    else if (b.dataset.p) { const p = prods.find(x => x.id === +b.dataset.p), r = await itemDialog(p.name, addons, null); if (r) apply(() => post(`/api/orders/${o.id}/items`, { product_id: p.id, ...r })); }
    else if (b.dataset.edit) { const it = o.items.find(i => i.id === +b.dataset.edit), r = await itemDialog(it.name, addons, it); if (r) apply(() => put(`/api/orders/${o.id}/items/${it.id}`, r)); }
    else if (b.dataset.del) { const it = o.items.find(i => i.id === +b.dataset.del); if (await confirmBox({ title: 'Remover item', msg: `Remover <b>${it.qty}× ${esc(it.name)}</b> da comanda?`, danger: true, ok: 'Remover' })) apply(() => del(`/api/orders/${o.id}/items/${it.id}`)); }
    else if (b.dataset.void) { const r = await confirmBox({ title: 'Estornar pagamento', msg: 'O pagamento será anulado e a operação ficará registrada na auditoria.', reason: true, danger: true, ok: 'Estornar' }); if (r) apply(() => del(`/api/orders/${o.id}/payments/${b.dataset.void}`, { reason: r })); }
    else if (b.dataset.st) { if (b.dataset.st === 'finalizada' && !await confirmBox({ title: 'Finalizar pedido', msg: `Finalizar a comanda <b>#${pad3(o.id)}</b> (${money(o.total)})?` })) return; apply(() => post(`/api/orders/${o.id}/status`, { status: b.dataset.st })); }
    else if (b.id === 'payb') { const amt = toCents($('#pa', m).value); if (!(amt > 0)) return toast('Informe um valor válido.', true); apply(() => post(`/api/orders/${o.id}/payments`, { method: $('#pm', m).value, amount: amt })); }
    else if (b.id === 'prt') printModal();
    else if (b.id === 'cancel') { const r = await confirmBox({ title: 'Cancelar comanda', msg: `Cancelar a comanda <b>#${pad3(o.id)}</b>? Esta ação não pode ser desfeita.`, reason: o.items.length > 0, danger: true, ok: 'Cancelar comanda' }); if (r) apply(() => post(`/api/orders/${o.id}/status`, { status: 'cancelada', reason: r === true ? '' : r })); }
    else if (b.id === 'disc') {
      const d = modal(`<h2>Aplicar desconto</h2><p class="muted">Subtotal: ${money(o.subtotal)}. O desconto fica registrado com o seu nome.</p><div class="row2"><label>Valor (R$)<input id="dv" inputmode="decimal" value="${fromCents(o.discount)}"></label><label>ou porcentagem (%)<input id="dp" inputmode="decimal" placeholder="Ex.: 10"></label></div><div class="acts"><button class="btn" id="dc">Cancelar</button><button class="btn pri" id="dok">Aplicar</button></div>`);
      $('#dc', d).onclick = () => d.close();
      $('#dok', d).onclick = () => { const pc = parseFloat(String($('#dp', d).value).replace(',', '.')); const v = pc > 0 ? Math.round(o.subtotal * pc / 100) : toCents($('#dv', d).value); d.close(); apply(() => post(`/api/orders/${o.id}/discount`, { value: v })); };
    } else if (b.id === 'cust') {
      const d = modal(`<h2>Cliente e observações</h2><label>Nome do cliente<input id="dn" maxlength="80" value="${esc(o.customer || '')}"></label><label>Observações<input id="do" maxlength="300" value="${esc(o.notes || '')}"></label><div class="acts"><button class="btn" id="dc">Cancelar</button><button class="btn pri" id="dok">Salvar</button></div>`);
      $('#dc', d).onclick = () => d.close(); $('#dok', d).onclick = () => { const c = $('#dn', d).value, n = $('#do', d).value; d.close(); apply(() => put('/api/orders/' + o.id, { customer: c, notes: n })); };
    }
  });
  draw();
}

/* ====== Caixa ====== */
const KIND = { recebimento_dinheiro: 'Recebimento — Dinheiro', recebimento_pix: 'Recebimento — PIX', recebimento_cartao: 'Recebimento — Cartão', sangria: 'Sangria (retirada)', reforco: 'Reforço de caixa', despesa: 'Despesa', entrada: 'Entrada avulsa' };
function cashBlocks(d, allowVoid) {
  const s = d.session, P = d.payments, M = d.moves;
  return `<div class="grid"><div class="kpi"><div class="l">Valor inicial</div><div class="v">${money(s.opening_amount)}</div></div><div class="kpi g"><div class="l">Dinheiro recebido</div><div class="v">${money(P.dinheiro)}</div></div><div class="kpi b"><div class="l">PIX</div><div class="v">${money(P.pix)}</div></div><div class="kpi b"><div class="l">Cartão</div><div class="v">${money(P.cartao)}</div></div><div class="kpi"><div class="l">Reforços + entradas</div><div class="v">${money(M.reforco + M.entrada)}</div></div><div class="kpi r"><div class="l">Sangrias + despesas</div><div class="v">${money(M.sangria + M.despesa)}</div></div><div class="kpi g"><div class="l">Dinheiro esperado na gaveta</div><div class="v">${money(d.expected)}</div></div></div>
  <div class="grid2" style="margin-top:16px"><div class="card"><h3>Recebido por funcionário (quem pegou o pagamento)</h3><div class="tblwrap"><table class="tbl"><tr><th>Funcionário</th><th>Dinheiro</th><th>PIX</th><th>Cartão</th><th>Total</th></tr>${d.byEmp.map(e => `<tr><td>${esc(e.name)}</td><td>${money(e.dinheiro)}</td><td>${money(e.pix)}</td><td>${money(e.cartao)}</td><td><b>${money(e.dinheiro + e.pix + e.cartao)}</b></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sem recebimentos.</td></tr>'}</table></div></div>
  <div class="card"><h3>Vendido por funcionário (pedidos finalizados no turno)</h3><div class="tblwrap"><table class="tbl"><tr><th>Funcionário</th><th>Pedidos</th><th>Total vendido</th></tr>${d.soldBy.map(e => `<tr><td>${esc(e.name)}</td><td>${e.n}</td><td><b>${money(e.total)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Sem vendas finalizadas.</td></tr>'}</table></div></div></div>
  <div class="card"><h3>Movimentações do caixa</h3><div class="tblwrap"><table class="tbl"><tr><th>Data/hora</th><th>Tipo</th><th>Descrição</th><th>Responsável</th><th class="right">Valor</th>${allowVoid ? '<th class="no-print"></th>' : ''}</tr>${d.ledger.map(r => `<tr class="${r.voided ? 'void' : ''}"><td class="nowrap">${fdt(r.at)}</td><td>${KIND[r.kind] || r.kind}</td><td>${esc(r.descr)}</td><td>${esc(r.who)}</td><td class="right nowrap">${r.sign < 0 ? '− ' : ''}${money(r.amount)}</td>${allowVoid ? `<td class="no-print">${r.src === 'm' && !r.voided ? `<button class="btn sm danger" data-mv="${r.id}">Estornar</button>` : ''}</td>` : ''}</tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhuma movimentação.</td></tr>'}</table></div></div>`;
}
function cashReportModal(d) {
  const s = d.session;
  const m = modal(`<h2>Relatório de caixa — turno #${s.id}</h2><p class="muted">Aberto por <b>${esc(s.opened_by_name)}</b> em ${fdt(s.opened_at)}${s.closed_at ? ` · Fechado por <b>${esc(s.closed_by_name)}</b> em ${fdt(s.closed_at)}` : ' · <b>em aberto</b>'}</p>
  ${s.status === 'fechado' ? `<div class="grid" style="margin-bottom:14px"><div class="kpi"><div class="l">Esperado</div><div class="v">${money(s.expected_cash)}</div></div><div class="kpi"><div class="l">Contado</div><div class="v">${money(s.counted_cash)}</div></div><div class="kpi ${s.difference === 0 ? 'g' : 'r'}"><div class="l">Diferença</div><div class="v">${s.difference > 0 ? '+' : ''}${money(s.difference)}</div></div></div>${s.notes ? `<p>Obs.: ${esc(s.notes)}</p>` : ''}` : ''}
  ${cashBlocks(d, false)}<div class="acts no-print"><button class="btn" id="rp">🖨️ Imprimir / salvar PDF</button><button class="btn pri" id="rc">Fechar</button></div>`, 'wide');
  $('#rp', m).onclick = printModal; $('#rc', m).onclick = () => m.close();
}
pages.caixa = {
  title: 'Caixa',
  async render(el) {
    const c = await get('/api/cash/current'); const adm = ME.role === 'admin';
    if (!c.open) {
      el.innerHTML = `<div class="pagehead"><h2>Caixa</h2></div><div class="card" style="max-width:480px"><h3>Caixa fechado</h3>${can('caixa') ? `<p class="muted">Informe o dinheiro que está na gaveta para começar o turno.</p><form id="of"><label>Valor inicial em dinheiro (R$)<input id="oa" value="0,00" inputmode="decimal"></label><button class="btn pri">Abrir caixa</button></form>` : '<p class="muted">Peça a um responsável com permissão de caixa para abrir. Sem caixa aberto não é possível receber pagamentos.</p>'}</div><div id="hist"></div>`;
      const f = $('#of'); if (f) f.onsubmit = e => { e.preventDefault(); guard(async () => { const v = toCents($('#oa').value); if (!(v >= 0)) throw new Error('Valor inválido.'); await post('/api/cash/open', { opening_amount: v }); toast('Caixa aberto.'); this.render(el); }); };
    } else if (c.limited) {
      el.innerHTML = `<div class="pagehead"><h2>Caixa</h2></div><div class="card"><span class="badge b-on">Caixa aberto</span> desde ${fdt(c.session.opened_at)} por <b>${esc(c.session.opened_by_name)}</b>.<p class="muted">Os valores do caixa são visíveis apenas para quem tem permissão de caixa.</p></div>`;
    } else {
      el.innerHTML = `<div class="pagehead"><h2>Caixa <span class="badge b-on">aberto</span></h2><div class="toolbar"><button class="btn" data-mv="reforco">+ Reforço</button><button class="btn" data-mv="entrada">+ Entrada</button><button class="btn" data-mv="sangria">Sangria</button><button class="btn" data-mv="despesa">Despesa</button><button class="btn danger" id="close">Fechar caixa</button></div></div><p class="muted">Turno #${c.session.id} aberto por <b>${esc(c.session.opened_by_name)}</b> em ${fdt(c.session.opened_at)}</p><div id="cb">${cashBlocks(c, adm)}</div><div id="hist"></div>`;
      const reload = () => this.render(el);
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.mv && b.closest('.toolbar')) {
          const t = b.dataset.mv, names = { reforco: 'Reforço de caixa', entrada: 'Entrada avulsa', sangria: 'Sangria (retirada)', despesa: 'Despesa paga com dinheiro do caixa' };
          const m = modal(`<h2>${names[t]}</h2><form id="mf"><label>Valor (R$)<input id="mv" inputmode="decimal" autofocus required></label><label>Descrição / motivo<input id="md" maxlength="200" required placeholder="${t === 'despesa' ? 'Ex.: compra de gelo' : t === 'sangria' ? 'Ex.: retirada para o cofre' : 'Descreva'}"></label><div class="acts"><button type="button" class="btn" id="mx">Cancelar</button><button class="btn pri">Registrar</button></div></form>`);
          $('#mx', m).onclick = () => m.close();
          $('#mf', m).onsubmit = ev => { ev.preventDefault(); guard(async () => { const v = toCents($('#mv', m).value); if (!(v > 0)) throw new Error('Informe um valor válido.'); await post('/api/cash/moves', { type: t, amount: v, description: $('#md', m).value }); m.close(); toast('Movimentação registrada.'); reload(); }); };
        } else if (b.dataset.mv) {
          confirmBox({ title: 'Estornar movimentação', msg: 'A movimentação será anulada. A alteração fica registrada na auditoria.', reason: true, danger: true, ok: 'Estornar' }).then(r => { if (r) guard(async () => { await post(`/api/cash/moves/${b.dataset.mv}/void`, { reason: r }); toast('Movimentação estornada.'); reload(); }); });
        } else if (b.id === 'close') {
          const m = modal(`<h2>Fechar caixa</h2>${c.openOrders ? `<div class="note">Atenção: existem <b>${c.openOrders}</b> comanda(s) ainda em aberto/preparo.</div>` : ''}<div class="line"><span>Dinheiro esperado na gaveta</span><b>${money(c.expected)}</b></div><label>Dinheiro contado (R$) — conte o dinheiro físico<input id="cc" inputmode="decimal" autofocus></label><div id="cd" class="line big"><span>Diferença</span><span>—</span></div><label>Observações<input id="cn" maxlength="300"></label><div class="acts"><button class="btn" id="cx">Voltar</button><button class="btn danger" id="cok">Fechar caixa</button></div>`);
          $('#cc', m).oninput = () => { const v = toCents($('#cc', m).value); $('#cd', m).lastElementChild.textContent = v >= 0 ? `${v - c.expected > 0 ? '+' : ''}${money(v - c.expected)}` : '—'; };
          $('#cx', m).onclick = () => m.close();
          $('#cok', m).onclick = () => guard(async () => { const v = toCents($('#cc', m).value); if (!(v >= 0) || $('#cc', m).value.trim() === '') throw new Error('Informe o valor contado.'); const d = await post('/api/cash/close', { counted_cash: v, notes: $('#cn', m).value }); m.close(); toast('Caixa fechado.'); await reload(); cashReportModal(d); });
        }
      };
    }
    if (adm) guard(async () => {
      const list = await get('/api/cash/sessions');
      $('#hist').innerHTML = `<div class="card"><h3>Histórico de caixas</h3><div class="tblwrap"><table class="tbl"><tr><th>Turno</th><th>Aberto por / em</th><th>Fechado por / em</th><th>Inicial</th><th>Esperado</th><th>Contado</th><th>Diferença</th><th></th></tr>${list.map(s => `<tr><td>#${s.id}</td><td>${esc(s.opened_by_name)}<br><span class="muted small">${fdt(s.opened_at)}</span></td><td>${s.closed_at ? `${esc(s.closed_by_name)}<br><span class="muted small">${fdt(s.closed_at)}</span>` : '<span class="badge b-on">aberto</span>'}</td><td>${money(s.opening_amount)}</td><td>${money(s.status === 'fechado' ? s.expected_cash : s.expected)}</td><td>${s.counted_cash == null ? '—' : money(s.counted_cash)}</td><td style="color:${s.difference ? 'var(--err)' : 'inherit'}">${s.difference == null ? '—' : money(s.difference)}</td><td><button class="btn sm" data-rep="${s.id}">Relatório</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nenhum caixa ainda.</td></tr>'}</table></div></div>`;
      $('#hist').onclick = e => { const b = e.target.closest('[data-rep]'); if (b) guard(async () => cashReportModal(await get('/api/cash/sessions/' + b.dataset.rep))); };
    });
  },
};

/* ====== Perfil de vendas (funcionário / minhas vendas) ====== */
async function renderProfile(el, uid, back) {
  let from = todayStr(), to = todayStr(), tab = 'v';
  const load = async () => {
    const d = await get(`/api/users/${uid}/profile?from=${from}&to=${to}`), u = d.user, R = d.recebido, V = d.vendasPag;
    const sum = o => o.dinheiro + o.pix + o.cartao;
    const pays = s => s ? s.split('|').map(x => { const [mt, v, who] = x.split(':'); return `${METHOD[mt]} ${money(+v)}${who !== u.name ? ` <span class="muted small">(recebido por ${esc(who)})</span>` : ''}`; }).join('<br>') : '<span class="muted">—</span>';
    el.innerHTML = `<div class="pagehead no-print"><h2>${back ? `<a href="#/func" style="color:var(--o2);text-decoration:none">← </a>` : ''}${esc(u.name)} <span class="muted small">@${esc(u.username)}</span> ${u.role === 'admin' ? '<span class="badge b-adm">ADM</span>' : ''} ${u.active ? '' : '<span class="badge b-off">bloqueado</span>'}</h2>
      <div class="toolbar"><button class="chip" data-r="0">Hoje</button><button class="chip" data-r="7">7 dias</button><button class="chip" data-r="30">30 dias</button><input type="date" id="pf" value="${from}"><input type="date" id="pt2" value="${to}"></div></div>
      <p class="muted">Período: ${fdate(from)} a ${fdate(to)}</p>
      <div class="grid"><div class="kpi"><div class="l">Pedidos realizados</div><div class="v">${d.pedidos}</div></div><div class="kpi g"><div class="l">Total vendido (finalizados)</div><div class="v">${money(d.vendido)}</div></div><div class="kpi b"><div class="l">Abertas / em andamento</div><div class="v">${d.abertas}</div></div><div class="kpi"><div class="l">Finalizadas</div><div class="v">${d.finalizadas}</div></div><div class="kpi r"><div class="l">Cancelamentos feitos</div><div class="v">${d.cancelamentos.n}</div><div class="muted small">${money(d.cancelamentos.t)}</div></div><div class="kpi r"><div class="l">Descontos concedidos</div><div class="v">${money(d.descontos.t)}</div><div class="muted small">${d.descontos.n} comanda(s)</div></div></div>
      <div class="grid2" style="margin-top:16px"><div class="card"><h3>💵 Dinheiro efetivamente recebido por ${esc(u.name.split(' ')[0])}</h3><div class="line"><span>Dinheiro</span><b>${money(R.dinheiro)}</b></div><div class="line"><span>PIX</span><b>${money(R.pix)}</b></div><div class="line"><span>Cartão</span><b>${money(R.cartao)}</b></div><div class="line big"><span>Total recebido</span><span>${money(sum(R))}</span></div><div class="muted small">Inclui ${money(d.deOutros)} de vendas feitas por outros funcionários.</div></div>
      <div class="card"><h3>🧾 Como as vendas dele foram pagas</h3><div class="line"><span>Dinheiro</span><b>${money(V.dinheiro)}</b></div><div class="line"><span>PIX</span><b>${money(V.pix)}</b></div><div class="line"><span>Cartão</span><b>${money(V.cartao)}</b></div><div class="line big"><span>Total pago</span><span>${money(sum(V))}</span></div><div class="muted small">${money(d.porOutros)} foram recebidos por outro funcionário.</div></div></div>
      <div class="chips no-print"><button class="chip ${tab === 'v' ? 'on' : ''}" data-t="v">Histórico de vendas</button><button class="chip ${tab === 'a' ? 'on' : ''}" data-t="a">Histórico de ações</button></div>
      <div class="card tblwrap">${tab === 'v' ? `<table class="tbl"><tr><th>Comanda</th><th>Abertura</th><th>Encerramento</th><th>Cliente</th><th>Status</th><th>Pagamentos</th><th>Desconto</th><th class="right">Total</th></tr>${d.vendas.map(v => `<tr><td>#${pad3(v.id)}</td><td class="nowrap">${fdt(v.created_at)}</td><td class="nowrap">${fdt(v.closed_at)}</td><td>${esc(v.customer || '—')}</td><td>${badge(v.status)}</td><td>${pays(v.pays)}</td><td>${v.discount ? money(v.discount) : '—'}</td><td class="right"><b>${money(v.total)}</b></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nenhuma venda no período.</td></tr>'}</table>` : `<table class="tbl"><tr><th>Data/hora</th><th>Ação</th><th>Detalhes</th></tr>${d.acoes.map(a => `<tr><td class="nowrap">${fdt(a.created_at)}</td><td>${esc(a.action.replace(/_/g, ' '))}${a.entity_id ? ` <span class="muted">#${esc(a.entity_id)}</span>` : ''}</td><td>${esc(a.details || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nenhuma ação no período.</td></tr>'}</table>`}</div>`;
    el.onclick = e => {
      const r = e.target.closest('[data-r]'), t = e.target.closest('[data-t]');
      if (r) { from = todayStr(-(+r.dataset.r)); to = todayStr(); guard(load); } else if (t) { tab = t.dataset.t; guard(load); }
    };
    $('#pf').onchange = () => { from = $('#pf').value || from; guard(load); }; $('#pt2').onchange = () => { to = $('#pt2').value || to; guard(load); };
  };
  await load();
}
pages.minhas = { title: 'Minhas vendas', render: el => renderProfile(el, ME.id) };

/* ====== Cardápio (somente leitura para funcionários) ====== */
pages.cardapio = {
  title: 'Cardápio',
  async render(el) {
    const prods = (await get('/api/products')).filter(p => p.active !== 0);
    el.innerHTML = `<div class="pagehead"><h2>Cardápio</h2></div>` + META.cats.map(c => { const l = prods.filter(p => p.category === c); return l.length ? `<h3>${c}</h3><div class="grid" style="margin-bottom:18px">${l.map(p => `<div class="card" style="margin:0">${p.photo ? `<img src="${esc(p.photo)}" class="thumb" style="width:100%;height:110px" alt="">` : ''}<b>${esc(p.name)}</b><div class="muted small">${esc(p.description || '')}</div><div style="color:var(--o2);font-weight:800">${money(p.price)}</div>${p.available ? '' : '<span class="badge b-off">Indisponível</span>'}</div>`).join('')}</div>` : ''; }).join('') || '<div class="card muted">Nenhum produto cadastrado ainda.</div>';
  },
};

/* ====== Menu, roteador e inicialização ====== */
const NAV = [
  { id: 'dash', l: '📊 Dashboard', admin: 1 }, { id: 'comandas', l: '🧾 Comandas', perm: 'comandas' }, { id: 'caixa', l: '💰 Caixa' },
  { id: 'minhas', l: '👤 Minhas vendas' }, { id: 'cardapio', l: '📖 Cardápio' }, { sep: 'Administração', admin: 1 },
  { id: 'func', l: '👥 Funcionários', admin: 1 }, { id: 'prod', l: '🍔 Produtos', admin: 1 }, { id: 'rel', l: '📈 Relatórios', admin: 1 }, { id: 'aud', l: '🛡️ Auditoria', admin: 1 },
];
const allowed = n => (!n.admin || ME.role === 'admin') && (!n.perm || can(n.perm));
async function route() {
  timers.splice(0).forEach(clearInterval); $$('.overlay').forEach(o => o.remove());
  let [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const def = ME.role === 'admin' ? 'dash' : can('comandas') ? 'comandas' : 'minhas';
  const pg = pages[name]; const nav = NAV.find(n => n.id === name);
  if (!pg || (nav && !allowed(nav))) { location.hash = '#/' + def; return; }
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.id === name)); $('#ptitle').textContent = pg.title; $('#side').classList.remove('open');
  const el = $('#main'); el.innerHTML = '<div class="muted">Carregando…</div>'; el.onclick = null;
  try { await pg.render(el, arg); } catch (e) { el.innerHTML = `<div class="card"><h3>Erro</h3><p>${esc(e.message)}</p></div>`; }
}
function loadScript(src) { return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Falha ao carregar ' + src)); document.head.appendChild(s); }); }
(async () => {
  const s = await get('/api/session'); if (!s.user) return location.reload();
  ME = s.user; META = s.meta; if (ME.role === 'admin') await loadScript('/js/admin.js');
  $('#nav').innerHTML = NAV.filter(allowed).map(n => n.sep ? `<div class="sep">${n.sep}</div>` : `<a href="#/${n.id}" data-id="${n.id}">${n.l}</a>`).join('');
  $('#me').innerHTML = `<b>${esc(ME.name)}</b><div class="muted">${ME.role === 'admin' ? 'Administrador' : 'Funcionário'} · @${esc(ME.username)}</div>`;
  $('#burger').onclick = () => $('#side').classList.toggle('open');
  $('#logout').onclick = async () => { await post('/api/logout').catch(() => {}); location.href = '/'; };
  $('#pw').onclick = () => {
    const m = modal(`<h2>Trocar senha</h2><form id="pf2"><label>Senha atual<input id="p1" type="password" autocomplete="current-password" required></label><label>Nova senha (mín. 6 caracteres)<input id="p2" type="password" autocomplete="new-password" required minlength="6"></label><div class="acts"><button type="button" class="btn" id="px">Cancelar</button><button class="btn pri">Salvar</button></div></form>`);
    $('#px', m).onclick = () => m.close();
    $('#pf2', m).onsubmit = e => { e.preventDefault(); guard(async () => { await post('/api/me/password', { current: $('#p1', m).value, password: $('#p2', m).value }); m.close(); toast('Senha alterada.'); }); };
  };
  window.addEventListener('hashchange', route); route();
})();
