'use strict';
/* ====== Área do administrador (só é entregue pelo servidor para contas ADM) ====== */

/* ---- Dashboard ---- */
pages.dash = {
  title: 'Dashboard',
  async render(el) {
    let date = todayStr();
    const load = async () => {
      const d = await get('/api/dashboard?date=' + date), R = d.recebido, max = Math.max(1, ...d.top.map(t => t.qty));
      el.innerHTML = `<div class="pagehead"><h2>Dashboard ${d.caixa ? '<span class="badge b-on">caixa aberto</span>' : '<span class="badge b-off">caixa fechado</span>'}</h2><div class="toolbar"><input type="date" id="dd" value="${d.date}"><button class="btn" id="dh">Hoje</button></div></div>
      <div class="grid"><div class="kpi g"><div class="l">Faturamento do dia</div><div class="v">${money(d.faturamento)}</div></div><div class="kpi"><div class="l">Pedidos do dia</div><div class="v">${d.criadas}</div></div><div class="kpi b"><div class="l">Pedidos em andamento</div><div class="v">${d.andamento}</div></div><div class="kpi"><div class="l">Pedidos finalizados</div><div class="v">${d.finalizadas}</div></div><div class="kpi r"><div class="l">Cancelados</div><div class="v">${d.canceladas}</div></div>
      <div class="kpi"><div class="l">Recebido em dinheiro</div><div class="v">${money(R.dinheiro)}</div></div><div class="kpi"><div class="l">Recebido em PIX</div><div class="v">${money(R.pix)}</div></div><div class="kpi"><div class="l">Recebido em cartão</div><div class="v">${money(R.cartao)}</div></div>
      <div class="kpi r"><div class="l">Despesas</div><div class="v">${money(d.despesas)}</div></div><div class="kpi r"><div class="l">Custo dos produtos</div><div class="v">${money(d.custo)}</div></div><div class="kpi ${d.lucro >= 0 ? 'g' : 'r'}"><div class="l">Lucro estimado</div><div class="v">${money(d.lucro)}</div><div class="muted small">faturamento − custo − despesas</div></div></div>
      <div class="grid2" style="margin-top:16px"><div class="card"><h3>Produtos mais vendidos</h3>${d.top.map(t => `<div class="barrow"><span>${esc(t.name)}</span><div><div class="bar" style="width:${Math.round(t.qty / max * 100)}%"></div></div><b>${t.qty}× · ${money(t.total)}</b></div>`).join('') || '<div class="muted">Sem vendas finalizadas neste dia.</div>'}</div>
      <div class="card"><h3>Vendas por funcionário</h3><div class="tblwrap"><table class="tbl"><tr><th>Funcionário</th><th>Pedidos</th><th class="right">Total</th></tr>${d.emp.map(e => `<tr><td><a href="#/func/${e.id}" style="color:var(--o2)">${esc(e.name)}</a></td><td>${e.pedidos}</td><td class="right"><b>${money(e.total)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Sem vendas finalizadas neste dia.</td></tr>'}</table></div></div></div>
      <div class="card"><h3>Histórico de movimentações do caixa</h3><div class="tblwrap"><table class="tbl"><tr><th>Data/hora</th><th>Tipo</th><th>Descrição</th><th>Responsável</th><th class="right">Valor</th></tr>${d.ledger.map(r => `<tr class="${r.voided ? 'void' : ''}"><td class="nowrap">${fdt(r.at)}</td><td>${KIND[r.kind] || r.kind}</td><td>${esc(r.descr)}</td><td>${esc(r.who)}</td><td class="right nowrap">${r.sign < 0 ? '− ' : ''}${money(r.amount)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhuma movimentação neste dia.</td></tr>'}</table></div></div>`;
      $('#dd').onchange = () => { date = $('#dd').value || todayStr(); guard(load); }; $('#dh').onclick = () => { date = todayStr(); guard(load); };
    };
    await load(); every(30000, () => { if (date === todayStr() && !$('.overlay')) load().catch(() => {}); });
  },
};

/* ---- Funcionários ---- */
function userForm(u, done) {
  const isNew = !u; u = u || { name: '', username: '', role: 'func', active: 1, perms: ['comandas', 'receber'] };
  const m = modal(`<h2>${isNew ? 'Novo funcionário' : 'Editar ' + esc(u.name)}</h2><form id="uf"><div class="row2"><label>Nome<input id="un" value="${esc(u.name)}" required maxlength="80"></label><label>Usuário (login)<input id="uu" value="${esc(u.username)}" required minlength="3" autocomplete="off"></label></div>
  <div class="row2"><label>${isNew ? 'Senha (mín. 6)' : 'Nova senha (vazio = manter)'}<input id="up" type="password" ${isNew ? 'required' : ''} minlength="6" autocomplete="new-password"></label><label>Tipo de acesso<select id="ur"><option value="func" ${u.role === 'func' ? 'selected' : ''}>Funcionário</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador (acesso total)</option></select></label></div>
  <div id="permbox"><div class="muted small" style="margin-top:6px">Permissões do funcionário</div><div class="perms">${META.perms.map(p => `<label class="chk"><input type="checkbox" value="${p}" ${u.perms.includes(p) ? 'checked' : ''}> ${PERM_LABEL[p]}</label>`).join('')}</div></div>
  <label class="chk"><input type="checkbox" id="ua" ${u.active ? 'checked' : ''}> Conta ativa (desmarque para bloquear o acesso)</label>
  <div class="acts"><button type="button" class="btn" id="ux">Cancelar</button><button class="btn pri">Salvar</button></div></form>`);
  const sync = () => { $("#permbox", m).hidden = $('#ur', m).value === 'admin'; }; $('#ur', m).onchange = sync; sync();
  $('#ux', m).onclick = () => m.close();
  $('#uf', m).onsubmit = e => {
    e.preventDefault();
    guard(async () => {
      const body = { name: $('#un', m).value, username: $('#uu', m).value.trim(), password: $('#up', m).value, role: $('#ur', m).value, active: $('#ua', m).checked, perms: $$('#permbox input:checked', m).map(c => c.value) };
      if (isNew) await post('/api/users', body); else await put('/api/users/' + u.id, body);
      m.close(); toast('Funcionário salvo.'); done();
    });
  };
}
pages.func = {
  title: 'Funcionários',
  async render(el, arg) {
    if (arg) return renderProfile(el, +arg, true);
    let rows = [];
    const draw = () => {
      el.innerHTML = `<div class="pagehead"><h2>Funcionários</h2><button class="btn pri" id="nu">+ Novo funcionário</button></div><div class="card tblwrap"><table class="tbl"><tr><th>Nome</th><th>Usuário</th><th>Acesso</th><th>Permissões</th><th>Vendido hoje</th><th>Status</th><th></th></tr>${rows.map(u => `<tr><td><b>${esc(u.name)}</b></td><td>@${esc(u.username)}</td><td>${u.role === 'admin' ? '<span class="badge b-adm">Administrador</span>' : 'Funcionário'}</td><td class="small">${u.role === 'admin' ? 'Todas' : u.perms.map(p => PERM_LABEL[p].split(' (')[0]).join(', ') || '<span class="muted">Somente visualizar</span>'}</td><td>${money(u.vendido_hoje)}</td><td>${u.active ? '<span class="badge b-on">Ativo</span>' : '<span class="badge b-off">Bloqueado</span>'}</td><td class="nowrap"><a class="btn sm" href="#/func/${u.id}" style="text-decoration:none">Perfil</a> <button class="btn sm" data-e="${u.id}">Editar</button> <button class="btn sm ${u.active ? 'danger' : 'ok'}" data-t="${u.id}">${u.active ? 'Bloquear' : 'Ativar'}</button></td></tr>`).join('')}</table></div>`;
    };
    const load = async () => { rows = await get('/api/users'); draw(); };
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'nu') userForm(null, load);
      else if (b.dataset.e) userForm(rows.find(u => u.id === +b.dataset.e), load);
      else if (b.dataset.t) {
        const u = rows.find(x => x.id === +b.dataset.t);
        if (await confirmBox({ title: u.active ? 'Bloquear conta' : 'Ativar conta', msg: u.active ? `Bloquear <b>${esc(u.name)}</b>? Ele será desconectado e não poderá entrar.` : `Reativar a conta de <b>${esc(u.name)}</b>?`, danger: !!u.active, ok: u.active ? 'Bloquear' : 'Ativar' }))
          guard(async () => { await put('/api/users/' + u.id, { name: u.name, username: u.username, role: u.role, perms: u.perms, active: !u.active }); toast(u.active ? 'Conta bloqueada.' : 'Conta ativada.'); load(); });
      }
    };
    await load();
  },
};

/* ---- Produtos ---- */
function readDataUrl(file) { return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('Não foi possível ler a imagem.')); r.readAsDataURL(file); }); }
async function shrinkImage(file, max = 640) {
  const src = await readDataUrl(file);
  return new Promise((ok, no) => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', 0.82)); }; img.onerror = () => no(new Error('Imagem inválida.')); img.src = src; });
}
function productForm(p, done) {
  const isNew = !p; p = p || { name: '', category: 'Hambúrgueres', description: '', price: 0, cost: 0, available: 1, stock_control: 0, stock: 0, active: 1, photo: null };
  let photo = p.photo;
  const m = modal(`<h2>${isNew ? 'Novo produto' : 'Editar produto'}</h2><form id="pf3"><div class="row2"><label>Nome<input id="pn" value="${esc(p.name)}" required maxlength="100"></label><label>Categoria<select id="pc">${META.cats.map(c => `<option ${c === p.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
  <label>Descrição<textarea id="pd" rows="2" maxlength="400">${esc(p.description || '')}</textarea></label>
  <div class="row2"><label>Preço de venda (R$)<input id="pp" inputmode="decimal" value="${fromCents(p.price)}" required></label><label>Custo de produção (R$)<input id="pk" inputmode="decimal" value="${fromCents(p.cost)}"></label></div>
  <div style="display:flex;gap:14px;align-items:center;margin:8px 0"><div id="ph" class="thumb" style="width:70px;height:70px">${photo ? `<img src="${esc(photo)}" class="thumb" style="width:70px;height:70px" alt="">` : '🍔'}</div><label style="flex:1;margin:0">Foto (opcional)<input id="pfile" type="file" accept="image/png,image/jpeg,image/webp"></label></div>
  <label class="chk"><input type="checkbox" id="pa" ${p.available ? 'checked' : ''}> Disponível para venda</label>
  <label class="chk"><input type="checkbox" id="ps2" ${p.stock_control ? 'checked' : ''}> Controlar estoque</label><label id="sw">Quantidade em estoque<input id="pst" type="number" min="0" value="${p.stock}"></label>
  ${isNew ? '' : `<label class="chk"><input type="checkbox" id="pact" ${p.active ? 'checked' : ''}> Produto ativo (desmarque para tirar do sistema sem apagar o histórico)</label>`}
  <div class="acts"><button type="button" class="btn" id="px">Cancelar</button><button class="btn pri">Salvar</button></div></form>`);
  const sync = () => { $('#sw', m).hidden = !$('#ps2', m).checked; }; $('#ps2', m).onchange = sync; sync();
  $('#px', m).onclick = () => m.close();
  $('#pfile', m).onchange = e => guard(async () => { const f = e.target.files[0]; if (!f) return; const data = await shrinkImage(f); const r = await post('/api/upload', { data }); photo = r.url; $('#ph', m).innerHTML = `<img src="${esc(photo)}" class="thumb" style="width:70px;height:70px" alt="">`; });
  $('#pf3', m).onsubmit = e => {
    e.preventDefault();
    guard(async () => {
      const price = toCents($('#pp', m).value), cost = toCents($('#pk', m).value || '0'); if (!(price >= 0) || !(cost >= 0)) throw new Error('Preço/custo inválido.');
      const body = { name: $('#pn', m).value, category: $('#pc', m).value, description: $('#pd', m).value, price, cost, photo, available: $('#pa', m).checked, stock_control: $('#ps2', m).checked, stock: +$('#pst', m).value || 0, active: isNew ? true : $('#pact', m).checked };
      if (isNew) await post('/api/products', body); else await put('/api/products/' + p.id, body);
      m.close(); toast('Produto salvo.'); done();
    });
  };
}
pages.prod = {
  title: 'Produtos',
  async render(el) {
    let list = [], cat = 'Todos', q = '';
    const draw = () => {
      const rows = list.filter(p => (cat === 'Todos' || p.category === cat) && p.name.toLowerCase().includes(q.toLowerCase()));
      $('#pt').innerHTML = `<tr><th></th><th>Produto</th><th>Categoria</th><th>Preço</th><th>Custo</th><th>Margem</th><th>Estoque</th><th>Status</th><th></th></tr>${rows.map(p => `<tr class="${p.active ? '' : 'void'}"><td>${p.photo ? `<img src="${esc(p.photo)}" class="thumb" alt="">` : '<div class="thumb">🍔</div>'}</td><td><b>${esc(p.name)}</b><div class="muted small">${esc(p.description || '')}</div></td><td>${p.category}</td><td>${money(p.price)}</td><td>${money(p.cost)}</td><td>${p.price ? Math.round((p.price - p.cost) / p.price * 100) + '%' : '—'}</td><td>${p.stock_control ? (p.stock <= 3 ? `<span style="color:var(--err)">${p.stock}</span>` : p.stock) : '—'}</td><td>${!p.active ? '<span class="badge b-off">Inativo</span>' : p.available ? '<span class="badge b-on">Disponível</span>' : '<span class="badge st-em_preparo">Indisponível</span>'}</td><td class="nowrap"><button class="btn sm" data-e="${p.id}">Editar</button> <button class="btn sm" data-a="${p.id}">${p.available ? 'Pausar' : 'Liberar'}</button> <button class="btn sm danger" data-d="${p.id}">Excluir</button></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Nenhum produto. Clique em "+ Novo produto" para cadastrar o primeiro.</td></tr>'}`;
    };
    const load = async () => { list = await get('/api/products'); draw(); };
    el.innerHTML = `<div class="pagehead"><h2>Produtos</h2><div class="toolbar"><input type="search" id="pq" placeholder="Buscar produto"><button class="btn pri" id="np">+ Novo produto</button></div></div><div class="chips">${['Todos', ...META.cats].map(c => `<button class="chip ${c === 'Todos' ? 'on' : ''}" data-c="${c}">${c}</button>`).join('')}</div><div class="card tblwrap"><table class="tbl" id="pt"></table></div>`;
    $('#pq').oninput = () => { q = $('#pq').value; draw(); };
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.c) { cat = b.dataset.c; $$('.chip', el).forEach(c => c.classList.toggle('on', c.dataset.c === cat)); draw(); }
      else if (b.id === 'np') productForm(null, load);
      else if (b.dataset.e) productForm(list.find(p => p.id === +b.dataset.e), load);
      else if (b.dataset.a) { const p = list.find(x => x.id === +b.dataset.a); guard(async () => { await put('/api/products/' + p.id, { ...p, available: !p.available }); load(); }); }
      else if (b.dataset.d) { const p = list.find(x => x.id === +b.dataset.d); if (await confirmBox({ title: 'Excluir produto', msg: `Excluir <b>${esc(p.name)}</b>? Se ele já tiver vendas, será apenas desativado para preservar o histórico.`, danger: true, ok: 'Excluir' })) guard(async () => { const r = await del('/api/products/' + p.id); toast(r.deactivated ? 'Produto tem vendas: foi desativado.' : 'Produto excluído.'); load(); }); }
    };
    await load();
  },
};

/* ---- Relatórios ---- */
const REPORTS = [['resumo', 'Faturamento, custos e lucro (dia / semana / mês)'], ['funcionarios', 'Por funcionário'], ['produtos', 'Por produto'], ['pagamentos', 'Por forma de pagamento'], ['caixas', 'Caixa e turno'], ['cancelamentos', 'Cancelamentos e estornos'], ['descontos', 'Descontos']];
pages.rel = {
  title: 'Relatórios',
  async render(el) {
    let from = todayStr(), to = todayStr(), cur = null;
    el.innerHTML = `<div class="pagehead no-print"><h2>Relatórios</h2></div><div class="card no-print"><div class="toolbar"><select id="rt">${REPORTS.map(r => `<option value="${r[0]}">${r[1]}</option>`).join('')}</select><select id="rg"><option value="dia">Agrupar por dia</option><option value="semana">Agrupar por semana</option><option value="mes">Agrupar por mês</option></select><input type="date" id="rf"><input type="date" id="rto"><button class="chip" data-p="hoje">Hoje</button><button class="chip" data-p="semana">Esta semana</button><button class="chip" data-p="mes">Este mês</button></div><div class="toolbar"><button class="btn pri" id="go">Gerar relatório</button><button class="btn" id="csv" disabled>⬇ Exportar CSV</button><button class="btn" id="prt" disabled>🖨️ Imprimir / salvar PDF</button></div><div class="muted small">Para PDF: clique em "Imprimir / salvar PDF" e escolha "Salvar como PDF" como impressora.</div></div><div id="out"></div>`;
    const sync = () => { $('#rf').value = from; $('#rto').value = to; $('#rg').hidden = $('#rt').value !== 'resumo'; }; sync();
    $('#rt').onchange = sync;
    const gen = () => guard(async () => {
      from = $('#rf').value || from; to = $('#rto').value || to;
      cur = await get(`/api/reports/${$('#rt').value}?from=${from}&to=${to}&group=${$('#rg').value}`);
      $('#out').innerHTML = `<div class="card"><h2>${esc(cur.title)}</h2><p class="muted">Período: ${fdate(cur.from)} a ${fdate(cur.to)} · Emitido em ${new Date().toLocaleString('pt-BR')} por ${esc(ME.name)}</p><div class="tblwrap"><table class="tbl"><tr>${cur.cols.map(c => `<th class="${c[2] === 'money' || c[2] === 'int' ? 'right' : ''}">${esc(c[1])}</th>`).join('')}</tr>${cur.rows.map(r => `<tr class="${r._total ? 'tot' : ''}">${cur.cols.map(c => `<td class="${c[2] === 'money' || c[2] === 'int' ? 'right nowrap' : ''}">${fmtCell(r[c[0]], c[2])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cur.cols.length}" class="muted">Nenhum dado no período.</td></tr>`}</table></div></div>`;
      $('#csv').disabled = $('#prt').disabled = false;
    });
    $('#go').onclick = gen;
    $('#csv').onclick = () => cur && downloadCSV(`relatorio-${$('#rt').value}-${cur.from}-a-${cur.to}`, cur.cols, cur.rows);
    $('#prt').onclick = () => window.print();
    el.addEventListener('click', e => {
      const p = e.target.closest('[data-p]'); if (!p) return; const d = new Date(); to = todayStr();
      if (p.dataset.p === 'hoje') from = to; else if (p.dataset.p === 'semana') from = todayStr(-((d.getDay() + 6) % 7)); else from = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
      sync(); gen();
    });
  },
};

/* ---- Auditoria e backup ---- */
pages.aud = {
  title: 'Auditoria',
  async render(el) {
    el.innerHTML = `<div class="pagehead"><h2>Auditoria</h2><div class="toolbar"><input type="search" id="aq" placeholder="Buscar (ação, pessoa, detalhe)"><input type="date" id="af"><input type="date" id="at"><button class="btn pri" id="ag">Filtrar</button><a class="btn" href="/api/backup" style="text-decoration:none" title="Baixa uma cópia completa do banco de dados">💾 Baixar backup</a></div></div><p class="muted">Registro de todas as ações importantes (logins, vendas, descontos, cancelamentos, estornos, caixa, cadastros). Mostra até 500 registros.</p><div class="card tblwrap"><table class="tbl" id="at2"></table></div>`;
    const load = () => guard(async () => {
      const qs = new URLSearchParams({ q: $('#aq').value, ...($('#af').value ? { from: $('#af').value } : {}), ...($('#at').value ? { to: $('#at').value } : {}) });
      const rows = await get('/api/audit?' + qs);
      $('#at2').innerHTML = `<tr><th>Data/hora</th><th>Quem</th><th>Ação</th><th>Detalhes</th></tr>${rows.map(r => `<tr><td class="nowrap">${fdt(r.created_at)}</td><td>${esc(r.user_name || '—')}</td><td>${esc(r.action.replace(/_/g, ' '))}${r.entity_id ? ` <span class="muted">${esc(r.entity)} #${esc(r.entity_id)}</span>` : ''}</td><td>${esc(r.details || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nada encontrado.</td></tr>'}`;
    });
    $('#ag').onclick = load; $('#aq').onkeydown = e => { if (e.key === 'Enter') load(); }; await load();
  },
};
