const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'praxis.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration INTEGER NOT NULL DEFAULT 45,
  price TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES services(id),
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
CREATE TABLE IF NOT EXISTS hours (
  weekday INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  open TEXT NOT NULL DEFAULT '08:00',
  close TEXT NOT NULL DEFAULT '17:00'
);
CREATE TABLE IF NOT EXISTS blocked (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL
);
`);

const DEFAULT_SETTINGS = {
  practice_name: 'Praxis für Ergotherapie',
  therapist: 'Anna Beispiel',
  phone: '01234 / 567 890',
  email: 'info@ergo-praxis.example',
  address: 'Musterstraße 12, 12345 Musterstadt',
  slot_step: '30',
  lead_hours: '12',
  max_days_ahead: '90',
  auto_confirm: '0',
};

function seed() {
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);

  if (!db.prepare('SELECT 1 FROM hours LIMIT 1').get()) {
    const h = db.prepare('INSERT INTO hours(weekday,enabled,open,close) VALUES (?,?,?,?)');
    // 0 = Sonntag … 6 = Samstag
    [[0, 0], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 0]].forEach(([d, e]) =>
      h.run(d, e, '08:00', d === 5 ? '14:00' : '17:00'));
  }
  if (!db.prepare('SELECT 1 FROM services LIMIT 1').get()) {
    const s = db.prepare('INSERT INTO services(name,description,duration,price,sort) VALUES (?,?,?,?,?)');
    s.run('Erstgespräch & Befunderhebung', 'Wir lernen uns kennen, klären Ihre Ziele und erheben gemeinsam den Status.', 60, 'Kassenleistung', 1);
    s.run('Ergotherapie für Kinder', 'Spielerische Förderung von Motorik, Wahrnehmung, Konzentration und Schulfähigkeit.', 45, 'Kassenleistung', 2);
    s.run('Ergotherapie für Erwachsene', 'Alltagsnahes Training nach Unfall, Schlaganfall oder bei chronischen Erkrankungen.', 45, 'Kassenleistung', 3);
    s.run('Handtherapie', 'Gezielte Behandlung nach Verletzungen, Operationen oder bei rheumatischen Beschwerden.', 30, 'Kassenleistung', 4);
    s.run('Hirnleistungstraining', 'Training von Gedächtnis, Aufmerksamkeit und Planungsfähigkeit.', 45, 'Selbstzahler: 55 €', 5);
  }
  if (!db.prepare('SELECT 1 FROM admins LIMIT 1').get()) {
    const username = process.env.ADMIN_USER || 'admin';
    const generated = !process.env.ADMIN_PASSWORD;
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
    db.prepare('INSERT INTO admins(username,hash) VALUES (?,?)').run(username, bcrypt.hashSync(password, 10));
    console.log('\n  Admin-Zugang angelegt:');
    console.log(`    Benutzer:  ${username}`);
    console.log(`    Passwort:  ${password}${generated ? '   (zufällig erzeugt – bitte im Admin-Bereich ändern)' : ''}\n`);
  }
}
seed();

const getSettings = () =>
  Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));

module.exports = { db, getSettings, DEFAULT_SETTINGS };
