'use strict';
// Banco de dados SQLite embutido no Node.js (sem instalar nada extra).
const fs = require('fs'), path = require('path');
const _ow = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : _ow.call(process, w, ...a));
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch (e) {
  console.error('\n[ERRO] Este sistema precisa do Node.js 22.13 ou mais novo (versão atual: ' + process.version + ').\nBaixe a versão LTS em https://nodejs.org e tente de novo.\n');
  process.exit(1);
}
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS = path.join(DATA, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'hamburgueria.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'func',active INTEGER NOT NULL DEFAULT 1,perms TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,photo TEXT,description TEXT,category TEXT NOT NULL,price INTEGER NOT NULL,cost INTEGER NOT NULL DEFAULT 0,available INTEGER NOT NULL DEFAULT 1,stock_control INTEGER NOT NULL DEFAULT 0,stock INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,customer TEXT,notes TEXT,user_id INTEGER NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'aberta',discount INTEGER NOT NULL DEFAULT 0,discount_by INTEGER,cancel_reason TEXT,cancelled_by INTEGER,created_at TEXT NOT NULL,closed_at TEXT);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL REFERENCES orders(id),product_id INTEGER,name TEXT NOT NULL,qty INTEGER NOT NULL,unit_price INTEGER NOT NULL,unit_cost INTEGER NOT NULL DEFAULT 0,addons TEXT NOT NULL DEFAULT '[]',addons_total INTEGER NOT NULL DEFAULT 0,note TEXT);
CREATE TABLE IF NOT EXISTS cash_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,opened_by INTEGER NOT NULL,opened_at TEXT NOT NULL,opening_amount INTEGER NOT NULL,closed_by INTEGER,closed_at TEXT,counted_cash INTEGER,expected_cash INTEGER,difference INTEGER,notes TEXT,status TEXT NOT NULL DEFAULT 'aberto');
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL REFERENCES orders(id),method TEXT NOT NULL,amount INTEGER NOT NULL,received_by INTEGER NOT NULL,session_id INTEGER NOT NULL,created_at TEXT NOT NULL,voided INTEGER NOT NULL DEFAULT 0,void_reason TEXT,voided_by INTEGER);
CREATE TABLE IF NOT EXISTS cash_moves(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id INTEGER NOT NULL,type TEXT NOT NULL,amount INTEGER NOT NULL,description TEXT,user_id INTEGER NOT NULL,created_at TEXT NOT NULL,voided INTEGER NOT NULL DEFAULT 0,void_reason TEXT,voided_by INTEGER);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT NOT NULL,entity TEXT,entity_id TEXT,details TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS ix_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS ix_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS ix_pay_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS ix_pay_session ON payments(session_id);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit(created_at);
DROP VIEW IF EXISTS v_orders;
CREATE VIEW v_orders AS SELECT *, (subtotal-discount) AS total FROM (
  SELECT o.*,
   COALESCE((SELECT SUM(qty*(unit_price+addons_total)) FROM order_items i WHERE i.order_id=o.id),0) AS subtotal,
   COALESCE((SELECT SUM(qty*unit_cost) FROM order_items i WHERE i.order_id=o.id),0) AS cost,
   COALESCE((SELECT SUM(amount) FROM payments p WHERE p.order_id=o.id AND p.voided=0),0) AS paid
  FROM orders o);
`);
const pad = n => String(n).padStart(2, '0');
const now = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const today = () => now().slice(0, 10);
function tx(fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; } }
function audit(u, action, entity, entityId, details) {
  db.prepare('INSERT INTO audit(user_id,user_name,action,entity,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(u ? u.id : null, u ? u.name : null, action, entity || null, entityId == null ? null : String(entityId), details || null, now());
}
module.exports = { db, tx, now, today, audit, UPLOADS, DATA };
