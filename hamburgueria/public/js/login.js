'use strict';
const $ = s => document.querySelector(s);
let tipo = 'func', setup = false;
async function call(url, body) {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'app' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Erro inesperado'); return j;
}
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab'); if (!b || setup) return; tipo = b.dataset.tipo;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t === b)); $('#err').textContent = '';
});
call('/api/session').then(s => {
  if (s.user) return location.reload();
  if (s.needsSetup) {
    setup = true; $('#tabs').hidden = true; $('#setup-name').hidden = false; $('#name').required = true;
    $('#sub').textContent = 'Primeiro acesso: crie a conta do administrador'; $('#ulabel').textContent = 'Usuário (para entrar)';
    $('#password').autocomplete = 'new-password'; $('#go').textContent = 'Criar administrador e entrar';
  }
});
$('#f').addEventListener('submit', async e => {
  e.preventDefault(); const btn = $('#go'); btn.disabled = true; $('#err').textContent = '';
  try {
    if (setup) await call('/api/setup', { name: $('#name').value, username: $('#username').value, password: $('#password').value });
    else await call('/api/login', { username: $('#username').value, password: $('#password').value, tipo });
    location.href = '/';
  } catch (er) { $('#err').textContent = er.message; btn.disabled = false; }
});
