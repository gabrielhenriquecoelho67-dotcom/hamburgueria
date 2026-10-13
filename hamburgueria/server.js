'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const { db, tx, now, today, audit, UPLOADS, DATA } = require('./db');
const PORT = Number(process.env.PORT) || 3000, HOST = process.env.HOST || '0.0.0.0';
const PUB = path.join(__dirname, 'public');
const PERMS = ['comandas', 'receber', 'desconto', 'cancelar', 'caixa'];
const CATS = ['Hambúrgueres', 'Combos', 'Porções', 'Bebidas', 'Sobremesas', 'Adicionais'];
const OPEN = ['aberta', 'em_preparo', 'pronta'];
const METHODS = ['dinheiro', 'pix', 'cartao'];
const SESSION_MS = 12 * 3600 * 1000;

class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
const bad = m => new HttpError(400, m);
const forbid = (m = 'Você não tem permissão para esta ação.') => new HttpError(403, m);
const int = v => { const n = Number(v); if (!Number.isFinite(n)) throw bad('Valor numérico inválido.'); return Math.round(n); };
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const can = (u, p) => u.role === 'admin' || u.perms.includes(p);
const R = c => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');
const pub = u => ({ id: u.id, name: u.name, username: u.username, role: u.role, perms: u.perms });

// ---------- senhas e sessões ----------
function hashPw(pw) { const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt$' + salt + '$' + crypto.scryptSync(pw, salt, 64).toString('hex'); }
function checkPw(pw, stored) {
  const [, salt, h] = String(stored).split('$'); const a = Buffer.from(h || '', 'hex'), b = crypto.scryptSync(pw, salt || 'x', 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function getUser(req) {
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='));
  if (!c) return null;
  const t = sha(c.slice(4));
  const row = db.prepare('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(t);
  if (!row) return null;
  if (row.expires_at < Date.now() || !row.active) { db.prepare('DELETE FROM sessions WHERE token=?').run(t); return null; }
  const u = { ...row }; delete u.password_hash;
  u.perms = u.role === 'admin' ? PERMS : JSON.parse(u.perms || '[]'); return u;
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(sha(token), userId, Date.now() + SESSION_MS);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
}

// ---------- roteador ----------
const routes = [], HANDLED = Symbol('handled');
const route = (m, p, opt, fn) => routes.push({ m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), opt, fn });
function readBody(req, limit) {
  return new Promise((ok, no) => {
    let n = 0; const ch = [];
    req.on('data', c => { n += c.length; if (n > limit) { no(new HttpError(413, 'Requisição muito grande.')); req.destroy(); return; } ch.push(c); });
    req.on('end', () => { if (!ch.length) return ok({}); try { ok(JSON.parse(Buffer.concat(ch).toString())); } catch { no(bad('JSON inválido.')); } });
    req.on('error', no);
  });
}
function json(res, status, data) { const b = JSON.stringify(data); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); }

// ---------- auth ----------
const fails = new Map();
route('GET', '/api/session', 'public', ({ u }) => ({
  user: u ? pub(u) : null,
  needsSetup: db.prepare('SELECT COUNT(*) c FROM users').get().c === 0,
  meta: { perms: PERMS, cats: CATS },
}));
route('POST', '/api/setup', 'public', ({ res, body }) => {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) throw forbid('O sistema já foi configurado.');
  const name = str(body.name, 80), username = str(body.username, 60), pw = String(body.password || '');
  if (!name || username.length < 3 || /\s/.test(username)) throw bad('Informe nome e um usuário (mín. 3 caracteres, sem espaços).');
  if (pw.length < 6) throw bad('A senha deve ter pelo menos 6 caracteres.');
  const id = db.prepare("INSERT INTO users(name,username,password_hash,role,perms,created_at) VALUES(?,?,?,'admin','[]',?)").run(name, username, hashPw(pw), now()).lastInsertRowid;
  audit({ id: Number(id), name }, 'setup', 'usuario', id, 'Administrador inicial criado');
  startSession(res, Number(id)); return { ok: true };
});
route('POST', '/api/login', 'public', ({ req, res, body }) => {
  const username = str(body.username, 60), pw = String(body.password || ''), tipo = body.tipo === 'admin' ? 'admin' : 'func';
  const key = req.socket.remoteAddress + '|' + username.toLowerCase(), f = fails.get(key);
  if (f && f.until > Date.now()) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  const ok = user ? checkPw(pw, user.password_hash) : (crypto.scryptSync('x', 'y', 64), false);
  if (!ok) {
    const n = ((f && f.n) || 0) + 1; fails.set(key, { n, until: n >= 5 ? Date.now() + 5 * 60000 : 0 });
    audit(null, 'login_falhou', 'usuario', null, 'Usuário informado: ' + username);
    throw new HttpError(401, 'Usuário ou senha inválidos.');
  }
  fails.delete(key);
  if (!user.active) throw forbid('Esta conta está bloqueada. Procure o administrador.');
  if (tipo === 'admin' && user.role !== 'admin') throw forbid('Esta conta não tem acesso de administrador.');
  if (tipo === 'func' && user.role === 'admin') throw forbid('Esta é uma conta de administrador. Use a aba "Administrador".');
  startSession(res, user.id); audit(user, 'login', 'usuario', user.id, 'Entrou no sistema');
  return { ok: true };
});
route('POST', '/api/logout', 'auth', ({ req, res, u }) => {
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='));
  if (c) db.prepare('DELETE FROM sessions WHERE token=?').run(sha(c.slice(4)));
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); audit(u, 'logout', 'usuario', u.id, 'Saiu do sistema');
});
route('POST', '/api/me/password', 'auth', ({ u, body }) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(u.id);
  if (!checkPw(String(body.current || ''), row.password_hash)) throw bad('Senha atual incorreta.');
  if (String(body.password || '').length < 6) throw bad('A nova senha deve ter pelo menos 6 caracteres.');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPw(body.password), u.id); audit(u, 'senha_alterada', 'usuario', u.id, 'Alterou a própria senha');
});

// ---------- usuários (ADM) ----------
const cleanPerms = p => (Array.isArray(p) ? p : []).filter(x => PERMS.includes(x));
const activeAdmins = (except) => db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1 AND id<>?").get(except || 0).c;
route('GET', '/api/users', 'admin', () => db.prepare(`SELECT u.id,u.name,u.username,u.role,u.active,u.perms,u.created_at,
  COALESCE((SELECT SUM(total) FROM v_orders v WHERE v.user_id=u.id AND v.status='finalizada' AND substr(v.closed_at,1,10)=?),0) vendido_hoje
  FROM users u ORDER BY u.active DESC,u.name`).all(today()).map(r => ({ ...r, perms: JSON.parse(r.perms) })));
route('POST', '/api/users', 'admin', ({ u, body }) => {
  const name = str(body.name, 80), username = str(body.username, 60), pw = String(body.password || '');
  if (!name) throw bad('Informe o nome.'); if (username.length < 3 || /\s/.test(username)) throw bad('Usuário inválido (mín. 3 caracteres, sem espaços).');
  if (pw.length < 6) throw bad('A senha deve ter pelo menos 6 caracteres.');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw bad('Já existe um usuário com esse login.');
  const role = body.role === 'admin' ? 'admin' : 'func';
  const id = db.prepare('INSERT INTO users(name,username,password_hash,role,active,perms,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(name, username, hashPw(pw), role, body.active === false ? 0 : 1, JSON.stringify(cleanPerms(body.perms)), now()).lastInsertRowid;
  audit(u, 'usuario_criado', 'usuario', id, `${name} (${username}) — ${role}`); return { id: Number(id) };
});
route('PUT', '/api/users/:id', 'admin', ({ u, params, body }) => {
  const id = Number(params.id), t = db.prepare('SELECT * FROM users WHERE id=?').get(id); if (!t) throw new HttpError(404, 'Usuário não encontrado.');
  const name = str(body.name, 80), username = str(body.username, 60); if (!name) throw bad('Informe o nome.');
  if (username.length < 3 || /\s/.test(username)) throw bad('Usuário inválido.');
  if (db.prepare('SELECT 1 FROM users WHERE username=? AND id<>?').get(username, id)) throw bad('Já existe um usuário com esse login.');
  const role = body.role === 'admin' ? 'admin' : 'func', active = body.active === false ? 0 : 1;
  if ((role !== 'admin' || !active) && t.role === 'admin' && t.active && activeAdmins(id) === 0) throw bad('É preciso manter pelo menos um administrador ativo.');
  if (id === u.id && !active) throw bad('Você não pode bloquear a própria conta.');
  tx(() => {
    db.prepare('UPDATE users SET name=?,username=?,role=?,active=?,perms=? WHERE id=?').run(name, username, role, active, JSON.stringify(cleanPerms(body.perms)), id);
    if (body.password) { if (String(body.password).length < 6) throw bad('A senha deve ter pelo menos 6 caracteres.'); db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPw(String(body.password)), id); }
    if (!active || body.password) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    audit(u, 'usuario_editado', 'usuario', id, `${name} — ${role}, ${active ? 'ativo' : 'bloqueado'}, perms: ${cleanPerms(body.perms).join(',') || 'nenhuma'}${body.password ? ', senha redefinida' : ''}`);
  });
});

function range(q) {
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s || ''); const t = today();
  let from = ok(q.from) ? q.from : t, to = ok(q.to) ? q.to : from; if (to < from) [from, to] = [to, from]; return { from, to };
}
const BT = c => `substr(${c},1,10) BETWEEN ? AND ?`;
route('GET', '/api/users/:id/profile', 'auth', ({ u, params, q }) => {
  const id = Number(params.id); if (u.role !== 'admin' && id !== u.id) throw forbid();
  const user = db.prepare('SELECT id,name,username,role,active,created_at FROM users WHERE id=?').get(id); if (!user) throw new HttpError(404, 'Funcionário não encontrado.');
  const { from, to } = range(q), R = [from, to];
  const st = db.prepare(`SELECT status,COUNT(*) n,COALESCE(SUM(total),0) t FROM v_orders WHERE user_id=? AND ${BT('created_at')} GROUP BY status`).all(id, ...R);
  const S = {}; st.forEach(r => S[r.status] = r);
  const sum = (arr) => arr.reduce((a, r) => a + r.n, 0);
  const recebido = { dinheiro: 0, pix: 0, cartao: 0 }, vendasPag = { dinheiro: 0, pix: 0, cartao: 0 };
  db.prepare(`SELECT method,SUM(amount) v FROM payments WHERE received_by=? AND voided=0 AND ${BT('created_at')} GROUP BY method`).all(id, ...R).forEach(r => recebido[r.method] = r.v);
  db.prepare(`SELECT p.method,SUM(p.amount) v FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.user_id=? AND p.voided=0 AND ${BT('p.created_at')} GROUP BY p.method`).all(id, ...R).forEach(r => vendasPag[r.method] = r.v);
  const deOutros = db.prepare(`SELECT COALESCE(SUM(p.amount),0) v FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.received_by=? AND o.user_id<>? AND p.voided=0 AND ${BT('p.created_at')}`).get(id, id, ...R).v;
  const porOutros = db.prepare(`SELECT COALESCE(SUM(p.amount),0) v FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.user_id=? AND p.received_by<>? AND p.voided=0 AND ${BT('p.created_at')}`).get(id, id, ...R).v;
  const canc = db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(subtotal),0) t FROM v_orders WHERE cancelled_by=? AND status='cancelada' AND ${BT('closed_at')}`).get(id, ...R);
  const desc = db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(discount),0) t FROM orders WHERE discount_by=? AND discount>0 AND ${BT('created_at')}`).get(id, ...R);
  const vendas = db.prepare(`SELECT v.id,v.created_at,v.closed_at,v.status,v.customer,v.total,v.discount,
    (SELECT group_concat(p.method||':'||p.amount||':'||ru.name,'|') FROM payments p JOIN users ru ON ru.id=p.received_by WHERE p.order_id=v.id AND p.voided=0) pays
    FROM v_orders v WHERE v.user_id=? AND ${BT('v.created_at')} ORDER BY v.id DESC LIMIT 300`).all(id, ...R);
  const acoes = db.prepare(`SELECT action,entity,entity_id,details,created_at FROM audit WHERE user_id=? AND ${BT('created_at')} ORDER BY id DESC LIMIT 200`).all(id, ...R);
  return {
    user, from, to,
    pedidos: sum(st), vendido: S.finalizada ? S.finalizada.t : 0,
    abertas: OPEN.reduce((a, s) => a + (S[s] ? S[s].n : 0), 0), finalizadas: S.finalizada ? S.finalizada.n : 0, canceladas: S.cancelada ? S.cancelada.n : 0,
    recebido, vendasPag, deOutros, porOutros, cancelamentos: canc, descontos: desc, vendas, acoes,
  };
});

// ---------- upload e produtos ----------
route('POST', '/api/upload', 'admin', ({ body }) => {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.data || ''); if (!m) throw bad('Imagem inválida (use PNG, JPG ou WEBP).');
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 2 * 1024 * 1024) throw bad('Imagem muito grande (máx. 2 MB).');
  const name = crypto.randomBytes(12).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  fs.writeFileSync(path.join(UPLOADS, name), buf); return { url: '/uploads/' + name };
});
route('GET', '/api/products', 'auth', ({ u }) => {
  const a = u.role === 'admin';
  return db.prepare(`SELECT * FROM products ${a ? '' : 'WHERE active=1'} ORDER BY category,name`).all()
    .map(p => a ? p : { id: p.id, name: p.name, photo: p.photo, description: p.description, category: p.category, price: p.price, available: p.available, stock_control: p.stock_control, stock: p.stock });
});
function prodInput(b) {
  const name = str(b.name, 100); if (!name) throw bad('Informe o nome do produto.');
  if (!CATS.includes(b.category)) throw bad('Categoria inválida.');
  const price = int(b.price), cost = int(b.cost || 0); if (price < 0 || cost < 0) throw bad('Preço e custo não podem ser negativos.');
  const sc = b.stock_control ? 1 : 0;
  return { name, photo: /^\/uploads\/[\w.]+$/.test(b.photo || '') ? b.photo : null, description: str(b.description, 400), category: b.category, price, cost, available: b.available === false || b.available === 0 ? 0 : 1, stock_control: sc, stock: sc ? Math.max(0, int(b.stock || 0)) : 0, active: b.active === false || b.active === 0 ? 0 : 1 };
}
route('POST', '/api/products', 'admin', ({ u, body }) => {
  const p = prodInput(body);
  const id = db.prepare('INSERT INTO products(name,photo,description,category,price,cost,available,stock_control,stock,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(p.name, p.photo, p.description, p.category, p.price, p.cost, p.available, p.stock_control, p.stock, p.active, now()).lastInsertRowid;
  audit(u, 'produto_criado', 'produto', id, `${p.name} — preço ${R(p.price)}`); return { id: Number(id) };
});
route('PUT', '/api/products/:id', 'admin', ({ u, params, body }) => {
  const id = Number(params.id), old = db.prepare('SELECT * FROM products WHERE id=?').get(id); if (!old) throw new HttpError(404, 'Produto não encontrado.');
  const p = prodInput(body);
  db.prepare('UPDATE products SET name=?,photo=?,description=?,category=?,price=?,cost=?,available=?,stock_control=?,stock=?,active=? WHERE id=?')
    .run(p.name, p.photo, p.description, p.category, p.price, p.cost, p.available, p.stock_control, p.stock, p.active, id);
  audit(u, 'produto_editado', 'produto', id, `${p.name}${old.price !== p.price ? ` — preço ${R(old.price)} → ${R(p.price)}` : ''}${old.cost !== p.cost ? ` — custo ${R(old.cost)} → ${R(p.cost)}` : ''}${old.available !== p.available ? ` — ${p.available ? 'disponível' : 'indisponível'}` : ''}${old.active !== p.active ? ` — ${p.active ? 'reativado' : 'desativado'}` : ''}`);
});
route('DELETE', '/api/products/:id', 'admin', ({ u, params }) => {
  const id = Number(params.id), p = db.prepare('SELECT * FROM products WHERE id=?').get(id); if (!p) throw new HttpError(404, 'Produto não encontrado.');
  if (db.prepare('SELECT 1 FROM order_items WHERE product_id=?').get(id)) {
    db.prepare('UPDATE products SET active=0 WHERE id=?').run(id); audit(u, 'produto_desativado', 'produto', id, p.name + ' (tem vendas, apenas desativado)');
    return { deactivated: true };
  }
  db.prepare('DELETE FROM products WHERE id=?').run(id); audit(u, 'produto_excluido', 'produto', id, p.name); return { deleted: true };
});

// ---------- comandas ----------
function stockAdj(pid, delta) {
  if (!pid || !delta) return; const p = db.prepare('SELECT name,stock_control,stock FROM products WHERE id=?').get(pid); if (!p || !p.stock_control) return;
  if (delta > 0 && p.stock < delta) throw bad(`Estoque insuficiente de "${p.name}" (restam ${p.stock}).`);
  db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(delta, pid);
}
function addonsFrom(ids) {
  ids = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  const list = ids.map(id => db.prepare("SELECT id,name,price,cost FROM products WHERE id=? AND category='Adicionais' AND active=1 AND available=1").get(id)).filter(Boolean).map(a => ({ id: a.id, name: a.name, price: a.price, cost: a.cost }));
  return { list, price: list.reduce((a, x) => a + x.price, 0), cost: list.reduce((a, x) => a + x.cost, 0) };
}
function orderFull(id) {
  const o = db.prepare(`SELECT v.*,u.name seller_name,d.name discount_by_name,c.name cancelled_by_name FROM v_orders v JOIN users u ON u.id=v.user_id LEFT JOIN users d ON d.id=v.discount_by LEFT JOIN users c ON c.id=v.cancelled_by WHERE v.id=?`).get(Number(id));
  if (!o) throw new HttpError(404, 'Comanda não encontrada.');
  const r = { ...o };
  r.items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(r.id).map(i => ({ ...i, addons: JSON.parse(i.addons) }));
  r.payments = db.prepare('SELECT p.*,ru.name received_by_name FROM payments p JOIN users ru ON ru.id=p.received_by WHERE p.order_id=? ORDER BY p.id').all(r.id);
  r.remaining = Math.max(0, r.total - r.paid); return r;
}
function openOrder(id) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(id)); if (!o) throw new HttpError(404, 'Comanda não encontrada.');
  if (!OPEN.includes(o.status)) throw bad('Esta comanda já foi encerrada e não pode ser alterada.'); return o;
}
const cashOpen = () => db.prepare("SELECT * FROM cash_sessions WHERE status='aberto' ORDER BY id DESC LIMIT 1").get();

route('GET', '/api/orders', 'perm:comandas', ({ q }) => {
  const base = `SELECT v.id,v.customer,v.status,v.total,v.paid,v.created_at,v.user_id,u.name seller_name,(SELECT COUNT(*) FROM order_items WHERE order_id=v.id) items FROM v_orders v JOIN users u ON u.id=v.user_id`;
  const term = str(q.q, 60);
  if (term) return db.prepare(`${base} WHERE v.id=? OR v.customer LIKE ? ORDER BY v.id DESC LIMIT 100`).all(Number(term) || -1, '%' + term + '%');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : today();
  return db.prepare(`${base} WHERE substr(v.created_at,1,10)=? OR (?=? AND v.status IN ('aberta','em_preparo','pronta')) ORDER BY v.id DESC LIMIT 500`).all(d, d, today());
});
route('POST', '/api/orders', 'perm:comandas', ({ u, body }) => {
  const id = db.prepare('INSERT INTO orders(customer,notes,user_id,created_at) VALUES(?,?,?,?)').run(str(body.customer, 80) || null, str(body.notes, 300) || null, u.id, now()).lastInsertRowid;
  audit(u, 'comanda_aberta', 'comanda', id, str(body.customer, 80) || 'sem nome'); return { id: Number(id) };
});
route('GET', '/api/orders/:id', 'perm:comandas', ({ params }) => orderFull(params.id));
route('PUT', '/api/orders/:id', 'perm:comandas', ({ u, params, body }) => {
  const o = openOrder(params.id); db.prepare('UPDATE orders SET customer=?,notes=? WHERE id=?').run(str(body.customer, 80) || null, str(body.notes, 300) || null, o.id);
  audit(u, 'comanda_editada', 'comanda', o.id, 'Cliente/observações'); return orderFull(o.id);
});
route('POST', '/api/orders/:id/items', 'perm:comandas', ({ u, params, body }) => tx(() => {
  const o = openOrder(params.id), p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(Number(body.product_id));
  if (!p) throw bad('Produto não encontrado.'); if (!p.available) throw bad('Produto indisponível no momento.');
  const qty = int(body.qty || 1); if (qty < 1 || qty > 99) throw bad('Quantidade inválida.');
  const ad = addonsFrom(body.addons); stockAdj(p.id, qty);
  db.prepare('INSERT INTO order_items(order_id,product_id,name,qty,unit_price,unit_cost,addons,addons_total,note) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(o.id, p.id, p.name, qty, p.price, p.cost + ad.cost, JSON.stringify(ad.list), ad.price, str(body.note) || null);
  audit(u, 'item_adicionado', 'comanda', o.id, `${qty}x ${p.name}`); return orderFull(o.id);
}));
const editGuard = (u, o) => { if (o.status !== 'aberta' && !can(u, 'cancelar')) throw forbid('A comanda já foi enviada ao preparo. Alterar ou remover itens exige autorização (permissão de cancelamento).'); };
route('PUT', '/api/orders/:id/items/:item', 'perm:comandas', ({ u, params, body }) => tx(() => {
  const o = openOrder(params.id); editGuard(u, o);
  const it = db.prepare('SELECT * FROM order_items WHERE id=? AND order_id=?').get(Number(params.item), o.id); if (!it) throw new HttpError(404, 'Item não encontrado.');
  const qty = int(body.qty || 1); if (qty < 1 || qty > 99) throw bad('Quantidade inválida.');
  const base = it.product_id ? db.prepare('SELECT cost FROM products WHERE id=?').get(it.product_id) : null;
  const oldAd = JSON.parse(it.addons), ad = body.addons ? addonsFrom(body.addons) : { list: oldAd, price: it.addons_total, cost: oldAd.reduce((a, x) => a + (x.cost || 0), 0) };
  const baseCost = it.unit_cost - oldAd.reduce((a, x) => a + (x.cost || 0), 0);
  stockAdj(it.product_id, qty - it.qty);
  db.prepare('UPDATE order_items SET qty=?,addons=?,addons_total=?,unit_cost=?,note=? WHERE id=?').run(qty, JSON.stringify(ad.list), ad.price, (base ? baseCost : it.unit_cost) + ad.cost, str(body.note) || null, it.id);
  audit(u, 'item_alterado', 'comanda', o.id, `${it.name}: ${it.qty} → ${qty}`); return orderFull(o.id);
}));
route('DELETE', '/api/orders/:id/items/:item', 'perm:comandas', ({ u, params }) => tx(() => {
  const o = openOrder(params.id); editGuard(u, o);
  const it = db.prepare('SELECT * FROM order_items WHERE id=? AND order_id=?').get(Number(params.item), o.id); if (!it) throw new HttpError(404, 'Item não encontrado.');
  stockAdj(it.product_id, -it.qty); db.prepare('DELETE FROM order_items WHERE id=?').run(it.id);
  const f = db.prepare('SELECT total,paid FROM v_orders WHERE id=?').get(o.id); if (f.paid > f.total) throw bad('Remover este item deixaria a comanda com valor pago acima do total. Estorne um pagamento antes.');
  audit(u, 'item_removido', 'comanda', o.id, `${it.qty}x ${it.name}`); return orderFull(o.id);
}));
route('POST', '/api/orders/:id/discount', 'perm:desconto', ({ u, params, body }) => tx(() => {
  const o = openOrder(params.id), v = int(body.value || 0), f = db.prepare('SELECT subtotal,paid FROM v_orders WHERE id=?').get(o.id);
  if (v < 0 || v > f.subtotal) throw bad('Desconto inválido (maior que o subtotal).'); if (f.subtotal - v < f.paid) throw bad('Desconto deixaria o total abaixo do valor já pago.');
  db.prepare('UPDATE orders SET discount=?,discount_by=? WHERE id=?').run(v, v ? u.id : null, o.id);
  audit(u, 'desconto', 'comanda', o.id, `Desconto de ${R(v)} (anterior: ${R(o.discount)})`); return orderFull(o.id);
}));
route('POST', '/api/orders/:id/status', 'perm:comandas', ({ u, params, body }) => tx(() => {
  const o = openOrder(params.id), s = body.status, f = db.prepare('SELECT total,paid FROM v_orders WHERE id=?').get(o.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
  if (s === 'cancelada') {
    const reason = str(body.reason, 200);
    if (items.length) { if (!can(u, 'cancelar')) throw forbid('Cancelar uma comanda com itens exige autorização.'); if (reason.length < 3) throw bad('Informe o motivo do cancelamento.'); }
    if (f.paid > 0) throw bad('Estorne os pagamentos antes de cancelar a comanda.');
    items.forEach(i => stockAdj(i.product_id, -i.qty));
    db.prepare("UPDATE orders SET status='cancelada',cancel_reason=?,cancelled_by=?,closed_at=? WHERE id=?").run(reason || 'Sem itens', u.id, now(), o.id);
    audit(u, 'comanda_cancelada', 'comanda', o.id, reason || 'Comanda vazia');
  } else if (s === 'finalizada') {
    if (!items.length) throw bad('A comanda não tem itens.'); if (f.paid < f.total) throw bad('Ainda há valor pendente de pagamento.');
    db.prepare("UPDATE orders SET status='finalizada',closed_at=? WHERE id=?").run(now(), o.id); audit(u, 'comanda_finalizada', 'comanda', o.id, `Total ${R(f.total)}`);
  } else if (OPEN.includes(s)) {
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(s, o.id); audit(u, 'status_alterado', 'comanda', o.id, `${o.status} → ${s}`);
  } else throw bad('Status inválido.');
  return orderFull(o.id);
}));
route('POST', '/api/orders/:id/payments', 'perm:receber', ({ u, params, body }) => tx(() => {
  const o = openOrder(params.id), s = cashOpen(); if (!s) throw bad('O caixa está fechado. Abra o caixa antes de receber pagamentos.');
  if (!METHODS.includes(body.method)) throw bad('Forma de pagamento inválida.');
  const amt = int(body.amount), f = db.prepare('SELECT total,paid FROM v_orders WHERE id=?').get(o.id);
  if (amt <= 0) throw bad('Informe um valor maior que zero.'); if (amt > f.total - f.paid) throw bad('O valor é maior que o restante da comanda.');
  db.prepare('INSERT INTO payments(order_id,method,amount,received_by,session_id,created_at) VALUES(?,?,?,?,?,?)').run(o.id, body.method, amt, u.id, s.id, now());
  audit(u, 'pagamento', 'comanda', o.id, `${body.method} ${R(amt)} (vendedor: ${db.prepare('SELECT name FROM users WHERE id=?').get(o.user_id).name})`); return orderFull(o.id);
}));
route('DELETE', '/api/orders/:id/payments/:pid', 'perm:cancelar', ({ u, params, body }) => tx(() => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(params.id)); if (!o) throw new HttpError(404, 'Comanda não encontrada.');
  const p = db.prepare('SELECT * FROM payments WHERE id=? AND order_id=? AND voided=0').get(Number(params.pid), o.id); if (!p) throw new HttpError(404, 'Pagamento não encontrado.');
  const reason = str(body.reason, 200); if (reason.length < 3) throw bad('Informe o motivo do estorno.');
  const sess = db.prepare('SELECT status FROM cash_sessions WHERE id=?').get(p.session_id);
  if ((o.status === 'finalizada' || o.status === 'cancelada' || sess.status !== 'aberto') && u.role !== 'admin') throw forbid('Estornar pagamento de venda encerrada ou de caixa fechado exige o administrador.');
  db.prepare('UPDATE payments SET voided=1,void_reason=?,voided_by=? WHERE id=?').run(reason, u.id, p.id);
  if (o.status === 'finalizada') db.prepare("UPDATE orders SET status='pronta',closed_at=NULL WHERE id=?").run(o.id);
  audit(u, 'pagamento_estornado', 'comanda', o.id, `${p.method} ${R(p.amount)} — ${reason}`); return orderFull(o.id);
}));

// ---------- caixa ----------
function sessionSummary(s) {
  const P = { dinheiro: 0, pix: 0, cartao: 0 }, M = { sangria: 0, reforco: 0, despesa: 0, entrada: 0 };
  db.prepare('SELECT method,COALESCE(SUM(amount),0) v FROM payments WHERE session_id=? AND voided=0 GROUP BY method').all(s.id).forEach(r => P[r.method] = r.v);
  db.prepare('SELECT type,COALESCE(SUM(amount),0) v FROM cash_moves WHERE session_id=? AND voided=0 GROUP BY type').all(s.id).forEach(r => M[r.type] = r.v);
  const expected = s.opening_amount + P.dinheiro + M.reforco + M.entrada - M.sangria - M.despesa;
  const byEmp = db.prepare(`SELECT u.id,u.name,COUNT(*) n,
    COALESCE(SUM(CASE WHEN p.method='dinheiro' THEN p.amount END),0) dinheiro,COALESCE(SUM(CASE WHEN p.method='pix' THEN p.amount END),0) pix,COALESCE(SUM(CASE WHEN p.method='cartao' THEN p.amount END),0) cartao
    FROM payments p JOIN users u ON u.id=p.received_by WHERE p.session_id=? AND p.voided=0 GROUP BY u.id ORDER BY u.name`).all(s.id);
  const end = s.closed_at || now();
  const soldBy = db.prepare(`SELECT u.name,COUNT(*) n,SUM(v.total) total FROM v_orders v JOIN users u ON u.id=v.user_id WHERE v.status='finalizada' AND v.closed_at>=? AND v.closed_at<=? GROUP BY u.id ORDER BY u.name`).all(s.opened_at, end);
  const n = db.prepare("SELECT COUNT(*) c FROM orders WHERE status IN ('aberta','em_preparo','pronta')").get().c;
  const full = db.prepare('SELECT s.*,o.name opened_by_name,c.name closed_by_name FROM cash_sessions s JOIN users o ON o.id=s.opened_by LEFT JOIN users c ON c.id=s.closed_by WHERE s.id=?').get(s.id);
  return { session: { ...full }, payments: P, moves: M, expected, byEmp, soldBy, openOrders: n };
}
function ledger(pc, mc, arg) {
  return db.prepare(`SELECT p.created_at at,'p' src,p.id id,'recebimento_'||p.method kind,'Comanda #'||p.order_id descr,p.amount amount,1 sign,u.name who,p.voided voided FROM payments p JOIN users u ON u.id=p.received_by WHERE ${pc}
    UNION ALL SELECT m.created_at,'m',m.id,m.type,COALESCE(m.description,''),m.amount,CASE WHEN m.type IN ('sangria','despesa') THEN -1 ELSE 1 END,u.name,m.voided FROM cash_moves m JOIN users u ON u.id=m.user_id WHERE ${mc}
    ORDER BY 1 DESC,3 DESC LIMIT 300`).all(arg, arg).map(r => ({ ...r }));
}
route('GET', '/api/cash/current', 'auth', ({ u }) => {
  const s = cashOpen(); if (!s) return { open: false };
  if (!can(u, 'caixa')) { const o = db.prepare('SELECT u.name FROM users u WHERE u.id=?').get(s.opened_by); return { open: true, limited: true, session: { id: s.id, opened_at: s.opened_at, opened_by_name: o.name } }; }
  return { open: true, ...sessionSummary(s), ledger: ledger('p.session_id=?', 'm.session_id=?', s.id) };
});
route('POST', '/api/cash/open', 'perm:caixa', ({ u, body }) => tx(() => {
  if (cashOpen()) throw bad('Já existe um caixa aberto.'); const v = int(body.opening_amount || 0); if (v < 0) throw bad('Valor inicial inválido.');
  const id = db.prepare('INSERT INTO cash_sessions(opened_by,opened_at,opening_amount) VALUES(?,?,?)').run(u.id, now(), v).lastInsertRowid;
  audit(u, 'caixa_aberto', 'caixa', id, `Valor inicial ${R(v)}`); return { id: Number(id) };
}));
route('POST', '/api/cash/moves', 'perm:caixa', ({ u, body }) => tx(() => {
  const s = cashOpen(); if (!s) throw bad('O caixa está fechado.'); const type = body.type;
  if (!['sangria', 'reforco', 'despesa', 'entrada'].includes(type)) throw bad('Tipo de movimentação inválido.');
  const amt = int(body.amount); if (amt <= 0) throw bad('Informe um valor maior que zero.');
  const d = str(body.description, 200); if (d.length < 3) throw bad('Informe uma descrição/motivo.');
  if ((type === 'sangria' || type === 'despesa') && amt > sessionSummary(s).expected) throw bad('O valor é maior que o dinheiro disponível no caixa.');
  const id = db.prepare('INSERT INTO cash_moves(session_id,type,amount,description,user_id,created_at) VALUES(?,?,?,?,?,?)').run(s.id, type, amt, d, u.id, now()).lastInsertRowid;
  audit(u, 'caixa_' + type, 'caixa', s.id, `${R(amt)} — ${d}`); return { id: Number(id) };
}));
route('POST', '/api/cash/moves/:id/void', 'admin', ({ u, params, body }) => {
  const m = db.prepare('SELECT * FROM cash_moves WHERE id=? AND voided=0').get(Number(params.id)); if (!m) throw new HttpError(404, 'Movimentação não encontrada.');
  const r = str(body.reason, 200); if (r.length < 3) throw bad('Informe o motivo da alteração.');
  db.prepare('UPDATE cash_moves SET voided=1,void_reason=?,voided_by=? WHERE id=?').run(r, u.id, m.id);
  audit(u, 'caixa_movimentacao_estornada', 'caixa', m.session_id, `${m.type} ${R(m.amount)} (${m.description}) — ${r}`);
});
route('POST', '/api/cash/close', 'perm:caixa', ({ u, body }) => tx(() => {
  const s = cashOpen(); if (!s) throw bad('Não há caixa aberto.'); const c = int(body.counted_cash); if (c < 0) throw bad('Valor contado inválido.');
  const exp = sessionSummary(s).expected, diff = c - exp;
  db.prepare("UPDATE cash_sessions SET status='fechado',closed_by=?,closed_at=?,counted_cash=?,expected_cash=?,difference=?,notes=? WHERE id=?").run(u.id, now(), c, exp, diff, str(body.notes, 300) || null, s.id);
  audit(u, 'caixa_fechado', 'caixa', s.id, `Esperado ${R(exp)}, contado ${R(c)}, diferença ${R(diff)}`);
  const s2 = db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(s.id); return { ...sessionSummary(s2), ledger: ledger('p.session_id=?', 'm.session_id=?', s.id) };
}));
route('GET', '/api/cash/sessions', 'admin', () => db.prepare('SELECT id FROM cash_sessions ORDER BY id DESC LIMIT 60').all().map(r => { const s = sessionSummary(db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(r.id)); return { ...s.session, expected: s.expected, payments: s.payments }; }));
route('GET', '/api/cash/sessions/:id', 'perm:caixa', ({ params }) => {
  const s = db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(Number(params.id)); if (!s) throw new HttpError(404, 'Caixa não encontrado.');
  return { ...sessionSummary(s), ledger: ledger('p.session_id=?', 'm.session_id=?', s.id) };
});

// ---------- dashboard ----------
route('GET', '/api/dashboard', 'admin', ({ q }) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : today();
  const fin = db.prepare("SELECT COUNT(*) n,COALESCE(SUM(total),0) fat,COALESCE(SUM(cost),0) custo,COALESCE(SUM(discount),0) desc_ FROM v_orders WHERE status='finalizada' AND substr(closed_at,1,10)=?").get(d);
  const criadas = db.prepare('SELECT COUNT(*) n FROM orders WHERE substr(created_at,1,10)=?').get(d).n;
  const andamento = db.prepare("SELECT COUNT(*) n FROM orders WHERE status IN ('aberta','em_preparo','pronta')").get().n;
  const canc = db.prepare("SELECT COUNT(*) n FROM orders WHERE status='cancelada' AND substr(closed_at,1,10)=?").get(d).n;
  const rec = { dinheiro: 0, pix: 0, cartao: 0 };
  db.prepare('SELECT method,SUM(amount) v FROM payments WHERE voided=0 AND substr(created_at,1,10)=? GROUP BY method').all(d).forEach(r => rec[r.method] = r.v);
  const desp = db.prepare("SELECT COALESCE(SUM(amount),0) v FROM cash_moves WHERE type='despesa' AND voided=0 AND substr(created_at,1,10)=?").get(d).v;
  const top = db.prepare("SELECT i.name,SUM(i.qty) qty,SUM(i.qty*(i.unit_price+i.addons_total)) total FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status='finalizada' AND substr(o.closed_at,1,10)=? GROUP BY i.name ORDER BY qty DESC LIMIT 8").all(d).map(r => ({ ...r }));
  const emp = db.prepare("SELECT u.id,u.name,COUNT(*) pedidos,SUM(v.total) total FROM v_orders v JOIN users u ON u.id=v.user_id WHERE v.status='finalizada' AND substr(v.closed_at,1,10)=? GROUP BY u.id ORDER BY total DESC").all(d).map(r => ({ ...r }));
  return { date: d, faturamento: fin.fat, finalizadas: fin.n, criadas, andamento, canceladas: canc, recebido: rec, despesas: desp, custo: fin.custo, descontos: fin.desc_, lucro: fin.fat - fin.custo - desp, top, emp, ledger: ledger('substr(p.created_at,1,10)=?', 'substr(m.created_at,1,10)=?', d), caixa: cashOpen() ? true : false };
});

// ---------- relatórios ----------
const brd = s => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : s;
const brdt = s => s ? brd(s.slice(0, 10)) + ' ' + s.slice(11, 16) : '';
route('GET', '/api/reports/:type', 'admin', ({ params, q }) => {
  const { from, to } = range(q), R = [from, to], t = params.type; let rep;
  const sumRow = (rows, label, keys) => { const r = { [label.k]: 'TOTAL', _total: true }; keys.forEach(k => r[k] = rows.reduce((a, x) => a + (x[k] || 0), 0)); return r; };
  if (t === 'resumo') {
    const g = ['dia', 'semana', 'mes'].includes(q.group) ? q.group : 'dia';
    const gx = c => g === 'dia' ? `substr(${c},1,10)` : g === 'mes' ? `substr(${c},1,7)` : `strftime('%Y-W%W',${c})`;
    const A = db.prepare(`SELECT ${gx('closed_at')} k,COUNT(*) pedidos,SUM(total) fat,SUM(cost) custo,SUM(discount) descontos FROM v_orders WHERE status='finalizada' AND ${BT('closed_at')} GROUP BY k`).all(...R);
    const B = db.prepare(`SELECT ${gx('created_at')} k,SUM(amount) v FROM cash_moves WHERE type='despesa' AND voided=0 AND ${BT('created_at')} GROUP BY k`).all(...R);
    const m = new Map(); const blank = k => ({ k, pedidos: 0, fat: 0, descontos: 0, custo: 0, despesas: 0 });
    A.forEach(r => m.set(r.k, { ...blank(r.k), pedidos: r.pedidos, fat: r.fat, descontos: r.descontos, custo: r.custo })); B.forEach(r => { const x = m.get(r.k) || blank(r.k); x.despesas = r.v; m.set(r.k, x); });
    const rows = [...m.values()].sort((a, b) => a.k < b.k ? -1 : 1).map(r => ({ periodo: brd(r.k), pedidos: r.pedidos, fat: r.fat, ticket: r.pedidos ? Math.round(r.fat / r.pedidos) : 0, descontos: r.descontos, custo: r.custo, despesas: r.despesas, lucro: r.fat - r.custo - r.despesas }));
    const tot = sumRow(rows, { k: 'periodo' }, ['pedidos', 'fat', 'descontos', 'custo', 'despesas', 'lucro']); tot.ticket = tot.pedidos ? Math.round(tot.fat / tot.pedidos) : 0; rows.push(tot);
    rep = { title: `Faturamento, custos e lucro estimado (por ${g === 'dia' ? 'dia' : g === 'mes' ? 'mês' : 'semana'})`, cols: [['periodo', 'Período', 'text'], ['pedidos', 'Pedidos', 'int'], ['fat', 'Faturamento', 'money'], ['ticket', 'Ticket médio', 'money'], ['descontos', 'Descontos', 'money'], ['custo', 'Custo dos produtos', 'money'], ['despesas', 'Despesas', 'money'], ['lucro', 'Lucro estimado', 'money']], rows };
  } else if (t === 'funcionarios') {
    const rows = db.prepare(`SELECT u.name funcionario,
      (SELECT COUNT(*) FROM v_orders v WHERE v.user_id=u.id AND v.status='finalizada' AND ${BT('v.closed_at')}) pedidos,
      (SELECT COALESCE(SUM(total),0) FROM v_orders v WHERE v.user_id=u.id AND v.status='finalizada' AND ${BT('v.closed_at')}) vendido,
      (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.received_by=u.id AND p.voided=0 AND p.method='dinheiro' AND ${BT('p.created_at')}) dinheiro,
      (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.received_by=u.id AND p.voided=0 AND p.method='pix' AND ${BT('p.created_at')}) pix,
      (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.received_by=u.id AND p.voided=0 AND p.method='cartao' AND ${BT('p.created_at')}) cartao,
      (SELECT COUNT(*) FROM orders o WHERE o.cancelled_by=u.id AND o.status='cancelada' AND ${BT('o.closed_at')}) cancelamentos,
      (SELECT COALESCE(SUM(discount),0) FROM orders o WHERE o.discount_by=u.id AND ${BT('o.created_at')}) descontos
      FROM users u ORDER BY vendido DESC,u.name`).all(...R, ...R, ...R, ...R, ...R, ...R, ...R).map(r => ({ ...r, recebido: r.dinheiro + r.pix + r.cartao }));
    rows.push(sumRow(rows, { k: 'funcionario' }, ['pedidos', 'vendido', 'dinheiro', 'pix', 'cartao', 'recebido', 'cancelamentos', 'descontos']));
    rep = { title: 'Vendas e recebimentos por funcionário', cols: [['funcionario', 'Funcionário', 'text'], ['pedidos', 'Pedidos finalizados', 'int'], ['vendido', 'Total vendido', 'money'], ['dinheiro', 'Recebeu em dinheiro', 'money'], ['pix', 'Recebeu em PIX', 'money'], ['cartao', 'Recebeu em cartão', 'money'], ['recebido', 'Total recebido', 'money'], ['cancelamentos', 'Cancelamentos', 'int'], ['descontos', 'Descontos dados', 'money']], rows };
  } else if (t === 'produtos') {
    const rows = db.prepare(`SELECT i.name produto,SUM(i.qty) qtd,SUM(i.qty*(i.unit_price+i.addons_total)) receita,SUM(i.qty*i.unit_cost) custo FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status='finalizada' AND ${BT('o.closed_at')} GROUP BY i.name ORDER BY qtd DESC`).all(...R).map(r => ({ ...r, lucro: r.receita - r.custo }));
    rows.push(sumRow(rows, { k: 'produto' }, ['qtd', 'receita', 'custo', 'lucro']));
    rep = { title: 'Vendas por produto (antes de descontos da comanda)', cols: [['produto', 'Produto', 'text'], ['qtd', 'Quantidade', 'int'], ['receita', 'Receita', 'money'], ['custo', 'Custo', 'money'], ['lucro', 'Lucro estimado', 'money']], rows };
  } else if (t === 'pagamentos') {
    const rows = db.prepare(`SELECT p.method forma,u.name recebedor,COUNT(*) qtd,SUM(p.amount) total FROM payments p JOIN users u ON u.id=p.received_by WHERE p.voided=0 AND ${BT('p.created_at')} GROUP BY p.method,u.id ORDER BY p.method,u.name`).all(...R).map(r => ({ ...r, forma: { dinheiro: 'Dinheiro', pix: 'PIX', cartao: 'Cartão' }[r.forma] }));
    rows.push(sumRow(rows, { k: 'forma' }, ['qtd', 'total']));
    rep = { title: 'Recebimentos por forma de pagamento e por quem recebeu', cols: [['forma', 'Forma de pagamento', 'text'], ['recebedor', 'Recebido por', 'text'], ['qtd', 'Pagamentos', 'int'], ['total', 'Total', 'money']], rows };
  } else if (t === 'caixas') {
    const rows = db.prepare(`SELECT id FROM cash_sessions WHERE ${BT('opened_at')} ORDER BY id`).all(...R).map(r => { const x = sessionSummary(db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(r.id)), s = x.session;
      return { turno: '#' + s.id, abertura: brdt(s.opened_at), aberto_por: s.opened_by_name, fechamento: brdt(s.closed_at) || 'Em aberto', fechado_por: s.closed_by_name || '', inicial: s.opening_amount, dinheiro: x.payments.dinheiro, pix: x.payments.pix, cartao: x.payments.cartao, esperado: s.status === 'fechado' ? s.expected_cash : x.expected, contado: s.counted_cash == null ? '' : s.counted_cash, diferenca: s.difference == null ? '' : s.difference }; });
    rep = { title: 'Caixas e turnos', cols: [['turno', 'Turno', 'text'], ['abertura', 'Abertura', 'text'], ['aberto_por', 'Aberto por', 'text'], ['fechamento', 'Fechamento', 'text'], ['fechado_por', 'Fechado por', 'text'], ['inicial', 'Valor inicial', 'money'], ['dinheiro', 'Dinheiro', 'money'], ['pix', 'PIX', 'money'], ['cartao', 'Cartão', 'money'], ['esperado', 'Esperado', 'money'], ['contado', 'Contado', 'money'], ['diferenca', 'Diferença', 'money']], rows };
  } else if (t === 'cancelamentos') {
    const a = db.prepare(`SELECT 'Comanda cancelada' tipo,v.closed_at dt,'#'||v.id ref,s.name vendedor,COALESCE(c.name,'') autorizado,COALESCE(v.cancel_reason,'') motivo,v.subtotal valor FROM v_orders v JOIN users s ON s.id=v.user_id LEFT JOIN users c ON c.id=v.cancelled_by WHERE v.status='cancelada' AND ${BT('v.closed_at')}`).all(...R);
    const b = db.prepare(`SELECT 'Pagamento estornado' tipo,p.created_at dt,'#'||p.order_id ref,s.name vendedor,COALESCE(x.name,'') autorizado,COALESCE(p.void_reason,'') motivo,p.amount valor FROM payments p JOIN orders o ON o.id=p.order_id JOIN users s ON s.id=o.user_id LEFT JOIN users x ON x.id=p.voided_by WHERE p.voided=1 AND ${BT('p.created_at')}`).all(...R);
    const rows = [...a, ...b].sort((x, y) => x.dt < y.dt ? 1 : -1).map(r => ({ ...r, dt: brdt(r.dt) }));
    rep = { title: 'Cancelamentos e estornos', cols: [['tipo', 'Tipo', 'text'], ['dt', 'Data/hora', 'text'], ['ref', 'Comanda', 'text'], ['vendedor', 'Vendedor', 'text'], ['autorizado', 'Autorizado por', 'text'], ['motivo', 'Motivo', 'text'], ['valor', 'Valor', 'money']], rows };
  } else if (t === 'descontos') {
    const rows = db.prepare(`SELECT v.id,v.created_at dt,s.name vendedor,COALESCE(d.name,'') autorizado,v.subtotal,v.discount desconto,v.total,v.status FROM v_orders v JOIN users s ON s.id=v.user_id LEFT JOIN users d ON d.id=v.discount_by WHERE v.discount>0 AND ${BT('v.created_at')} ORDER BY v.id DESC`).all(...R).map(r => ({ ...r, id: '#' + r.id, dt: brdt(r.dt), status: r.status.replace('_', ' ') }));
    rows.push(sumRow(rows, { k: 'id' }, ['subtotal', 'desconto', 'total']));
    rep = { title: 'Descontos concedidos', cols: [['id', 'Comanda', 'text'], ['dt', 'Data/hora', 'text'], ['vendedor', 'Vendedor', 'text'], ['autorizado', 'Autorizado por', 'text'], ['subtotal', 'Subtotal', 'money'], ['desconto', 'Desconto', 'money'], ['total', 'Total', 'money'], ['status', 'Status', 'text']], rows };
  } else throw new HttpError(404, 'Relatório não encontrado.');
  return { ...rep, from, to };
});

// ---------- auditoria e backup ----------
route('GET', '/api/audit', 'admin', ({ q }) => {
  const { from, to } = range({ from: q.from || '2000-01-01', to: q.to || '2999-12-31' }), term = '%' + str(q.q, 60) + '%';
  return db.prepare(`SELECT * FROM audit WHERE ${BT('created_at')} AND (action LIKE ? OR details LIKE ? OR user_name LIKE ?) ORDER BY id DESC LIMIT 500`).all(from, to, term, term, term).map(r => ({ ...r }));
});
route('GET', '/api/backup', 'admin', ({ u, res }) => {
  const f = path.join(DATA, 'backup-tmp.db'); try { fs.unlinkSync(f); } catch {}
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`); const b = fs.readFileSync(f); fs.unlinkSync(f);
  audit(u, 'backup', 'sistema', null, 'Backup baixado');
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="backup-hamburgueria-${today()}.db"` }); res.end(b); return HANDLED;
});

// ---------- servidor HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
function safe(base, rel) { const f = path.resolve(base, rel); if (!f.startsWith(base + path.sep)) throw new HttpError(404, 'Não encontrado.'); return f; }
function sendFile(res, f, cache) {
  let b; try { b = fs.readFileSync(f); } catch { throw new HttpError(404, 'Não encontrado.'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': cache || 'no-cache' }); res.end(b);
}
function handleStatic(req, res, p) {
  if (req.method !== 'GET') throw new HttpError(405, 'Método não permitido.');
  const u = getUser(req);
  if (p === '/' || p === '/index.html' || p === '/login') return sendFile(res, path.join(PUB, u ? 'app.html' : 'login.html'), 'no-store');
  if (p.startsWith('/uploads/')) { if (!u) throw new HttpError(401, 'Não autorizado.'); return sendFile(res, safe(UPLOADS, p.slice(9)), 'private, max-age=3600'); }
  if (p === '/js/app.js' && !u) throw new HttpError(401, 'Não autorizado.');
  if (p === '/js/admin.js' && (!u || u.role !== 'admin')) throw forbid('Acesso restrito ao administrador.');
  if (!/^\/(css|js)\/[\w.-]+$/.test(p)) throw new HttpError(404, 'Página não encontrada.');
  sendFile(res, safe(PUB, p.slice(1)));
}
async function handleApi(req, res, url, p) {
  const r = routes.find(r => r.m === req.method && r.re.test(p));
  if (!r) throw new HttpError(404, 'Rota não encontrada.');
  const params = r.re.exec(p).groups || {}, u = getUser(req);
  if (r.opt !== 'public') {
    if (!u) throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
    if (r.opt === 'admin' && u.role !== 'admin') throw forbid('Acesso restrito ao administrador.');
    if (r.opt.startsWith('perm:') && !can(u, r.opt.slice(5))) throw forbid();
  }
  let body = {};
  if (req.method !== 'GET') { if (req.headers['x-requested-with'] !== 'app') throw forbid('Requisição inválida.'); body = await readBody(req, p === '/api/upload' ? 4e6 : 2e5); }
  const out = await r.fn({ req, res, u, params, q: Object.fromEntries(url.searchParams), body });
  if (out === HANDLED) return; json(res, 200, out === undefined ? { ok: true } : out);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, 'http://x'), p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) await handleApi(req, res, url, p); else handleStatic(req, res, p);
  } catch (e) {
    const status = e.status || 500; if (!e.status) console.error(e);
    const msg = e.status ? e.message : 'Erro interno do servidor.';
    if (req.url.startsWith('/api/')) json(res, status, { error: msg }); else { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg); }
  }
});
server.listen(PORT, HOST, () => {
  console.log('\n  🍔 Sistema da Hamburgueria rodando!\n');
  console.log(`  Neste computador:  http://localhost:${PORT}`);
  for (const l of Object.values(os.networkInterfaces()).flat()) if (l && l.family === 'IPv4' && !l.internal) console.log(`  Outros aparelhos:  http://${l.address}:${PORT}  (mesma rede Wi-Fi/cabo)`);
  console.log(`\n  Dados salvos em: ${DATA}\n  Para parar: Ctrl+C\n`);
});
process.on('SIGINT', () => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {} process.exit(0); });
