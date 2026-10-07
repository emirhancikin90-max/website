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
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
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
  notify: '1',
  // Design
  color_primary: '#3f7d6b',
  color_accent: '#e07a5f',
  font: 'serif',
  // Texte
  hero_eyebrow: 'Ergotherapie für Kinder & Erwachsene',
  hero_title: 'Mehr *Selbstständigkeit* im Alltag – Schritt für Schritt.',
  hero_text: 'Wir begleiten Sie und Ihre Familie einfühlsam, alltagsnah und mit viel Zeit. Ihren Termin buchen Sie in wenigen Klicks – rund um die Uhr.',
  trust: 'Alle Kassen & Privat\nHausbesuche möglich\nKurze Wartezeiten',
  services_title: 'Therapie, die zu Ihrem Alltag passt',
  services_text: 'Jede Behandlung beginnt mit Ihren Zielen – nicht mit einem Standardprogramm.',
  steps_title: 'In drei Schritten zur Therapie',
  step1_t: 'Termin wählen', step1_x: 'Leistung, Wunschtermin und Ihre Kontaktdaten – das war\'s schon. Ohne Anmeldung, ohne Passwort.',
  step2_t: 'Kennenlernen', step2_x: 'Im Erstgespräch klären wir Anliegen, Ziele und bringen bei Bedarf die ärztliche Verordnung auf den Weg.',
  step3_t: 'Gemeinsam üben', step3_x: 'Wir arbeiten praxisnah an dem, was Ihnen im Alltag wichtig ist – mit Spaß und in Ihrem Tempo.',
  about_title: 'Ich bin Anna Beispiel',
  about_text: 'Als Ergotherapeutin begleite ich Menschen jeden Alters dabei, ihren Alltag wieder selbstbestimmt zu gestalten – ob beim Schreibenlernen, nach einem Unfall oder bei Konzentrationsproblemen.\n\nMir ist eine ruhige, vertrauensvolle Atmosphäre wichtig. Eltern, Angehörige und behandelnde Ärztinnen und Ärzte beziehe ich gern mit ein.',
  about_image: '',
  hero_image: '',
  // Rechtliches
  impressum: '## Angaben gemäß § 5 DDG\nPraxis für Ergotherapie\nInhaberin: Anna Beispiel\nMusterstraße 12, 12345 Musterstadt\n\n## Kontakt\nTelefon: 01234 / 567 890\nE-Mail: info@ergo-praxis.example\n\n## Berufsbezeichnung & Aufsicht\nErgotherapeutin (verliehen in Deutschland). Zuständige Kammer / Aufsichtsbehörde: …\n\nBitte ersetzen Sie diesen Platzhalter durch Ihre rechtlich geprüften Angaben.',
  datenschutz: '## Verantwortlicher\nPraxis für Ergotherapie, Musterstraße 12, 12345 Musterstadt.\n\n## Terminbuchung\nBei der Online-Terminbuchung speichern wir Name, E-Mail, optional Telefonnummer und Nachricht sowie den gewählten Termin, um Ihren Termin zu organisieren (Art. 6 Abs. 1 lit. b DSGVO). Die Daten werden nach Ablauf der gesetzlichen Fristen gelöscht.\n\n## Cookies\nDiese Seite setzt keine Tracking-Cookies und bindet keine externen Dienste ein. Nur im Admin-Bereich wird ein technisch notwendiges Sitzungs-Cookie verwendet.\n\n## Ihre Rechte\nAuskunft, Berichtigung, Löschung, Einschränkung, Widerspruch und Beschwerde bei einer Aufsichtsbehörde.\n\nBitte lassen Sie diesen Text rechtlich prüfen.',
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
  if (!db.prepare('SELECT 1 FROM items LIMIT 1').get()) {
    const i = db.prepare('INSERT INTO items(type,title,body,sort) VALUES (?,?,?,?)');
    i.run('testimonial', 'Familie M.', 'Unser Sohn geht inzwischen gern zur Therapie und schreibt viel sicherer. Wir fühlen uns hier rundum gut aufgehoben.', 1);
    i.run('testimonial', 'Herr K.', 'Nach meinem Schlaganfall hat mir die Therapie Schritt für Schritt Selbstständigkeit zurückgegeben. Sehr einfühlsam!', 2);
    i.run('faq', 'Brauche ich eine Verordnung?', 'Für Kassenleistungen benötigen Sie eine ärztliche Verordnung. Gern helfen wir Ihnen im Erstgespräch weiter.', 1);
    i.run('faq', 'Was kostet eine Behandlung?', 'Bei ärztlicher Verordnung übernimmt die Kasse die Kosten abzüglich der gesetzlichen Zuzahlung. Selbstzahler-Preise finden Sie bei den Leistungen.', 2);
    i.run('faq', 'Was passiert, wenn ich nicht kommen kann?', 'Bitte sagen Sie Ihren Termin über den Link in Ihrer Bestätigung oder telefonisch spätestens 24 Stunden vorher ab.', 3);
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
