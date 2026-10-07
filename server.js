process.env.TZ = process.env.TZ || 'Europe/Berlin';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const mail = require('./mail');
const { db, getSettings } = require('./db');
const UPLOAD_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    },
  },
}));
const jsonSmall = express.json({ limit: '50kb' });
app.use((req, res, next) => req.method === 'POST' && req.path.startsWith('/api/admin/upload/') ? next() : jsonSmall(req, res, next));

// ---------- helpers ----------
const pad = n => String(n).padStart(2, '0');
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00'));
const isTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const wrap = fn => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };

function slotsFor(date, serviceId) {
  const svc = db.prepare('SELECT * FROM services WHERE id=? AND active=1').get(serviceId);
  if (!svc || !isDate(date)) return [];
  const s = getSettings();
  const now = new Date();
  const dayStart = new Date(date + 'T00:00:00');
  const maxDays = Number(s.max_days_ahead);
  if (dayStart - new Date(todayStr() + 'T00:00:00') > maxDays * 864e5) return [];
  if (db.prepare('SELECT 1 FROM blocked WHERE date=?').get(date)) return [];
  const h = db.prepare('SELECT * FROM hours WHERE weekday=?').get(new Date(date + 'T12:00:00').getDay());
  if (!h || !h.enabled) return [];
  const busy = db.prepare("SELECT start,end FROM appointments WHERE date=? AND status!='cancelled'").all(date)
    .map(a => [toMin(a.start), toMin(a.end)]);
  const step = Math.max(5, Number(s.slot_step));
  const earliest = now.getTime() + Number(s.lead_hours) * 36e5;
  const out = [];
  for (let m = toMin(h.open); m + svc.duration <= toMin(h.close); m += step) {
    if (dayStart.getTime() + m * 6e4 < earliest) continue;
    if (busy.some(([a, b]) => m < b && m + svc.duration > a)) continue;
    out.push(fromMin(m));
  }
  return out;
}

// ---------- sessions ----------
const sessions = new Map();
const SESSION_MS = 8 * 36e5;
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(c => c[0]));
}
function requireAdmin(req, res, next) {
  const sid = parseCookies(req).sid;
  const sess = sid && sessions.get(sid);
  if (!sess || sess.exp < Date.now()) { sessions.delete(sid); return res.status(401).json({ error: 'Nicht angemeldet' }); }
  sess.exp = Date.now() + SESSION_MS;
  req.admin = sess;
  next();
}

// ---------- Theme ----------
const CONTENT_KEYS = ['hero_eyebrow', 'hero_title', 'hero_text', 'trust', 'services_title', 'services_text', 'steps_title',
  'step1_t', 'step1_x', 'step2_t', 'step2_x', 'step3_t', 'step3_x', 'about_title', 'about_text', 'about_image', 'hero_image'];
const isHex = c => /^#[0-9a-f]{6}$/i.test(c);
function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, sat = 0;
  if (d) {
    sat = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [Math.round(h), Math.round(sat * 100), Math.round(l * 100)];
}
const hsl = (h, s, l) => `hsl(${h} ${Math.max(0, Math.min(100, s))}% ${Math.max(0, Math.min(100, l))}%)`;
app.get('/theme.css', wrap((req, res) => {
  const s = getSettings();
  const primary = isHex(s.color_primary) ? s.color_primary : '#3f7d6b';
  const accent = isHex(s.color_accent) ? s.color_accent : '#e07a5f';
  const [h, sat, l] = hexToHsl(primary), [ah, as] = hexToHsl(accent);
  const sans = "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif";
  res.type('text/css').set('Cache-Control', 'no-cache').send(`:root{
  --primary:${primary};--primary-d:${hsl(h, sat, Math.min(l, 45) - 10)};--primary-l:${hsl(h, Math.min(sat, 45), 93)};
  --accent:${accent};--accent-l:${hsl(ah, Math.min(as, 70), 93)};
  --bg:${hsl(h, 28, 97)};--sand:${hsl(h, 24, 92)};--line:${hsl(h, 16, 87)};--ink:${hsl(h, 22, 17)};--muted:${hsl(h, 8, 42)};
  ${s.font === 'sans' ? `--serif:${sans};` : ''}}
${s.font === 'sans' ? 'h1,h2,h3{letter-spacing:-.02em;font-weight:700}' : ''}`);
}));

// ---------- E-Mail ----------
const deDate = d => d.split('-').reverse().join('.');
const baseUrl = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
function notifyBooking(req, a) {
  const s = getSettings();
  if (s.notify !== '1' || !mail.enabled) return;
  const link = `${baseUrl(req)}/termin?t=${a.token}`;
  const confirmed = a.status === 'confirmed';
  mail.send({ from: s.email, to: a.email, replyTo: s.email,
    subject: confirmed ? `Ihr Termin am ${deDate(a.date)} ist bestätigt` : `Ihre Terminanfrage für den ${deDate(a.date)}`,
    text: `Guten Tag ${a.name},\n\n${confirmed ? 'Ihr Termin ist bestätigt' : 'vielen Dank für Ihre Anfrage – wir bestätigen den Termin schnellstmöglich'}:\n\n${a.service}\n${deDate(a.date)}, ${a.start}–${a.end} Uhr\n\nTermin ansehen oder absagen: ${link}\n\nViele Grüße\n${s.practice_name}\n${s.phone}` });
  mail.send({ from: s.email, to: s.email, replyTo: a.email, subject: `Neue Terminanfrage: ${a.name}, ${deDate(a.date)} ${a.start}`,
    text: `${a.name} (${a.email}${a.phone ? ', ' + a.phone : ''})\n${a.service}\n${deDate(a.date)}, ${a.start}–${a.end} Uhr\nStatus: ${a.status}\n\n${a.message || ''}\n\nVerwalten: ${baseUrl(req)}/admin#termine` });
}
function notifyStatus(req, id) {
  const s = getSettings();
  if (s.notify !== '1' || !mail.enabled) return;
  const a = db.prepare('SELECT a.*, sv.name AS service FROM appointments a JOIN services sv ON sv.id=a.service_id WHERE a.id=?').get(id);
  if (!a || !a.email) return;
  const link = `${baseUrl(req)}/termin?t=${a.token}`;
  const text = a.status === 'confirmed'
    ? `Guten Tag ${a.name},\n\nIhr Termin ist bestätigt:\n${a.service}\n${deDate(a.date)}, ${a.start}–${a.end} Uhr\n\nTermin ansehen oder absagen: ${link}\n\nViele Grüße\n${s.practice_name}`
    : `Guten Tag ${a.name},\n\nleider müssen wir Ihren Termin (${a.service}, ${deDate(a.date)}, ${a.start} Uhr) absagen. Bitte buchen Sie gern einen neuen Termin auf unserer Website oder rufen Sie uns an: ${s.phone}\n\nViele Grüße\n${s.practice_name}`;
  mail.send({ from: s.email, to: a.email, replyTo: s.email, subject: a.status === 'confirmed' ? 'Ihr Termin ist bestätigt' : 'Ihr Termin wurde abgesagt', text });
}

// ---------- public API ----------
const publicLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
const bookLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Zu viele Anfragen – bitte später erneut versuchen.' } });

app.get('/api/public', publicLimiter, wrap((req, res) => {
  const s = getSettings();
  res.json({
    settings: { practice_name: s.practice_name, therapist: s.therapist, phone: s.phone, email: s.email,
      address: s.address, max_days_ahead: Number(s.max_days_ahead), auto_confirm: s.auto_confirm === '1' },
    content: Object.fromEntries(CONTENT_KEYS.map(k => [k, s[k] ?? ''])),
    testimonials: db.prepare("SELECT title,body FROM items WHERE type='testimonial' ORDER BY sort,id").all(),
    faqs: db.prepare("SELECT title,body FROM items WHERE type='faq' ORDER BY sort,id").all(),
    services: db.prepare('SELECT id,name,description,duration,price FROM services WHERE active=1 ORDER BY sort,id').all(),
    hours: db.prepare('SELECT weekday,enabled,open,close FROM hours ORDER BY (weekday+6)%7').all(),
  });
}));

app.get('/api/legal/:page', publicLimiter, wrap((req, res) => {
  if (!['impressum', 'datenschutz'].includes(req.params.page)) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ text: getSettings()[req.params.page] });
}));

app.get('/api/availability', publicLimiter, wrap((req, res) => {
  const { service, from, days } = req.query;
  const n = Math.min(Number(days) || 14, 42);
  const start = isDate(from) ? new Date(from + 'T12:00:00') : new Date();
  const result = {};
  for (let i = 0; i < n; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    result[ds] = slotsFor(ds, Number(service));
  }
  res.json(result);
}));

app.post('/api/appointments', bookLimiter, wrap((req, res) => {
  const b = req.body || {};
  const name = str(b.name, 100), email = str(b.email, 150), phone = str(b.phone, 40), message = str(b.message, 1000);
  const date = str(b.date, 10), start = str(b.start, 5), serviceId = Number(b.service_id);
  if (b.website) return res.json({ ok: true }); // Honeypot
  if (name.length < 2) return res.status(400).json({ error: 'Bitte geben Sie Ihren Namen an.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Bitte geben Sie eine gültige E-Mail-Adresse an.' });
  if (!b.privacy) return res.status(400).json({ error: 'Bitte stimmen Sie der Datenschutzerklärung zu.' });
  if (!isDate(date) || !isTime(start)) return res.status(400).json({ error: 'Ungültiger Termin.' });

  const result = db.transaction(() => {
    if (!slotsFor(date, serviceId).includes(start)) return null;
    const svc = db.prepare('SELECT * FROM services WHERE id=?').get(serviceId);
    const token = crypto.randomBytes(16).toString('hex');
    const status = getSettings().auto_confirm === '1' ? 'confirmed' : 'pending';
    const end = fromMin(toMin(start) + svc.duration);
    db.prepare(`INSERT INTO appointments(service_id,date,start,end,name,email,phone,message,status,token)
                VALUES (?,?,?,?,?,?,?,?,?,?)`).run(serviceId, date, start, end, name, email, phone, message, status, token);
    return { token, status, end, service: svc.name };
  })();
  if (!result) return res.status(409).json({ error: 'Dieser Zeitpunkt ist leider nicht mehr verfügbar. Bitte wählen Sie einen anderen.' });
  notifyBooking(req, { name, email, phone, message, date, start, ...result });
  res.status(201).json({ ok: true, date, start, ...result });
}));

app.get('/api/booking/:token', publicLimiter, wrap((req, res) => {
  const a = db.prepare(`SELECT a.date,a.start,a.end,a.status,a.name,s.name AS service FROM appointments a
    JOIN services s ON s.id=a.service_id WHERE a.token=?`).get(req.params.token);
  if (!a) return res.status(404).json({ error: 'Termin nicht gefunden.' });
  res.json(a);
}));
app.post('/api/booking/:token/cancel', publicLimiter, wrap((req, res) => {
  const r = db.prepare("UPDATE appointments SET status='cancelled' WHERE token=? AND status!='cancelled'").run(req.params.token);
  if (!r.changes) return res.status(404).json({ error: 'Termin nicht gefunden oder bereits abgesagt.' });
  res.json({ ok: true });
}));

// ---------- admin API ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche – bitte später erneut versuchen.' } });

app.post('/api/admin/login', loginLimiter, wrap((req, res) => {
  const { username, password } = req.body || {};
  const a = db.prepare('SELECT * FROM admins WHERE username=?').get(str(username, 60));
  const ok = bcrypt.compareSync(String(password || ''), a ? a.hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
  if (!a || !ok) return res.status(401).json({ error: 'Benutzername oder Passwort falsch.' });
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { id: a.id, username: a.username, exp: Date.now() + SESSION_MS });
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ ok: true, username: a.username });
}));
app.post('/api/admin/logout', (req, res) => {
  sessions.delete(parseCookies(req).sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

const admin = express.Router();
admin.use(requireAdmin);
app.use('/api/admin', admin);

admin.get('/me', (req, res) => res.json({ username: req.admin.username }));

admin.get('/dashboard', wrap((req, res) => {
  const today = todayStr();
  const q = sql => db.prepare(sql).get(today).c;
  res.json({
    pending: db.prepare("SELECT COUNT(*) c FROM appointments WHERE status='pending' AND date>=?").get(today).c,
    today: q("SELECT COUNT(*) c FROM appointments WHERE status!='cancelled' AND date=?"),
    upcoming: q("SELECT COUNT(*) c FROM appointments WHERE status!='cancelled' AND date>=?"),
    patients: db.prepare("SELECT COUNT(DISTINCT lower(email)) c FROM appointments WHERE status!='cancelled'").get().c,
    next: db.prepare(`SELECT a.*, s.name AS service FROM appointments a JOIN services s ON s.id=a.service_id
      WHERE a.status!='cancelled' AND (a.date>? OR (a.date=? AND a.end>=?)) ORDER BY a.date,a.start LIMIT 8`)
      .all(today, today, (() => { const n = new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; })()),
    week: (() => {
      const out = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        out.push({ date: ds, count: db.prepare("SELECT COUNT(*) c FROM appointments WHERE date=? AND status!='cancelled'").get(ds).c });
      }
      return out;
    })(),
  });
}));

admin.get('/appointments', wrap((req, res) => {
  const { status, from, to, q } = req.query;
  const where = [], args = [];
  if (['pending', 'confirmed', 'cancelled'].includes(status)) { where.push('a.status=?'); args.push(status); }
  if (isDate(from || '')) { where.push('a.date>=?'); args.push(from); }
  if (isDate(to || '')) { where.push('a.date<=?'); args.push(to); }
  if (q) { where.push('(a.name LIKE ? OR a.email LIKE ? OR a.phone LIKE ?)'); const l = `%${str(q, 60)}%`; args.push(l, l, l); }
  res.json(db.prepare(`SELECT a.id,a.date,a.start,a.end,a.name,a.email,a.phone,a.message,a.status,a.created_at,
    a.service_id, s.name AS service FROM appointments a JOIN services s ON s.id=a.service_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.date DESC,a.start DESC LIMIT 500`).all(...args));
}));

admin.post('/appointments', wrap((req, res) => {
  const b = req.body || {};
  const serviceId = Number(b.service_id), date = str(b.date, 10), start = str(b.start, 5);
  const svc = db.prepare('SELECT * FROM services WHERE id=?').get(serviceId);
  if (!svc || !isDate(date) || !isTime(start) || str(b.name, 100).length < 2)
    return res.status(400).json({ error: 'Bitte Leistung, Datum, Uhrzeit und Name angeben.' });
  const end = fromMin(toMin(start) + svc.duration);
  const clash = db.prepare("SELECT 1 FROM appointments WHERE date=? AND status!='cancelled' AND start<? AND end>?").get(date, end, start);
  if (clash) return res.status(409).json({ error: 'In diesem Zeitraum existiert bereits ein Termin.' });
  const info = db.prepare(`INSERT INTO appointments(service_id,date,start,end,name,email,phone,message,status,token)
    VALUES (?,?,?,?,?,?,?,?,'confirmed',?)`).run(serviceId, date, start, end, str(b.name, 100), str(b.email, 150),
    str(b.phone, 40), str(b.message, 1000), crypto.randomBytes(16).toString('hex'));
  res.status(201).json({ id: info.lastInsertRowid });
}));

admin.patch('/appointments/:id', wrap((req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'confirmed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
  const r = db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status, req.params.id);
  if (r.changes && status !== 'pending') notifyStatus(req, req.params.id);
  res.status(r.changes ? 200 : 404).json({ ok: !!r.changes });
}));
admin.delete('/appointments/:id', wrap((req, res) => {
  db.prepare('DELETE FROM appointments WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

admin.get('/services', (req, res) => res.json(db.prepare('SELECT * FROM services ORDER BY sort,id').all()));
function serviceFields(b) {
  const duration = Math.round(Number(b.duration));
  if (str(b.name, 100).length < 2 || !(duration >= 5 && duration <= 480)) return null;
  return [str(b.name, 100), str(b.description, 400), duration, str(b.price, 60), b.active ? 1 : 0, Number(b.sort) || 0];
}
admin.post('/services', wrap((req, res) => {
  const f = serviceFields(req.body || {});
  if (!f) return res.status(400).json({ error: 'Name und Dauer (5–480 Min.) sind erforderlich.' });
  const info = db.prepare('INSERT INTO services(name,description,duration,price,active,sort) VALUES (?,?,?,?,?,?)').run(...f);
  res.status(201).json({ id: info.lastInsertRowid });
}));
admin.put('/services/:id', wrap((req, res) => {
  const f = serviceFields(req.body || {});
  if (!f) return res.status(400).json({ error: 'Name und Dauer (5–480 Min.) sind erforderlich.' });
  db.prepare('UPDATE services SET name=?,description=?,duration=?,price=?,active=?,sort=? WHERE id=?').run(...f, req.params.id);
  res.json({ ok: true });
}));
admin.delete('/services/:id', wrap((req, res) => {
  const used = db.prepare('SELECT COUNT(*) c FROM appointments WHERE service_id=?').get(req.params.id).c;
  if (used) {
    db.prepare('UPDATE services SET active=0 WHERE id=?').run(req.params.id);
    return res.json({ ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM services WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

admin.get('/schedule', (req, res) => res.json({
  hours: db.prepare('SELECT * FROM hours ORDER BY (weekday+6)%7').all(),
  blocked: db.prepare('SELECT * FROM blocked WHERE date>=? ORDER BY date').all(todayStr()),
}));
admin.put('/hours', wrap((req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  const up = db.prepare('UPDATE hours SET enabled=?,open=?,close=? WHERE weekday=?');
  for (const r of rows) {
    if (!isTime(r.open) || !isTime(r.close) || toMin(r.open) >= toMin(r.close))
      return res.status(400).json({ error: 'Öffnungszeiten ungültig (Beginn muss vor Ende liegen).' });
  }
  db.transaction(() => rows.forEach(r => up.run(r.enabled ? 1 : 0, r.open, r.close, Number(r.weekday))))();
  res.json({ ok: true });
}));
admin.post('/blocked', wrap((req, res) => {
  const date = str(req.body?.date, 10);
  if (!isDate(date)) return res.status(400).json({ error: 'Ungültiges Datum' });
  db.prepare('INSERT OR REPLACE INTO blocked(date,reason) VALUES (?,?)').run(date, str(req.body.reason, 100));
  res.status(201).json({ ok: true });
}));
admin.delete('/blocked/:id', wrap((req, res) => {
  db.prepare('DELETE FROM blocked WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

admin.get('/settings', (req, res) => res.json({ ...getSettings(), mail_enabled: mail.enabled }));
admin.put('/settings', wrap((req, res) => {
  const allowed = { practice_name: 100, therapist: 100, phone: 40, email: 150, address: 200,
    slot_step: 3, lead_hours: 3, max_days_ahead: 3, auto_confirm: 1, notify: 1,
    hero_eyebrow: 100, hero_title: 200, hero_text: 600, trust: 300, services_title: 120, services_text: 400, steps_title: 120,
    step1_t: 60, step1_x: 300, step2_t: 60, step2_x: 300, step3_t: 60, step3_x: 300, about_title: 120, about_text: 3000,
    impressum: 20000, datenschutz: 20000, font: 5 };
  const b = req.body || {};
  for (const k of ['color_primary', 'color_accent']) if (k in b && !isHex(String(b[k]))) return res.status(400).json({ error: 'Ungültige Farbe.' });
  if ('font' in b && !['serif', 'sans'].includes(b.font)) return res.status(400).json({ error: 'Ungültige Schrift.' });
  const up = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)');
  db.transaction(() => {
    for (const [k, max] of Object.entries(allowed)) if (k in b) up.run(k, String(b[k] ?? '').replace(/\r/g, '').trim().slice(0, max));
    for (const k of ['color_primary', 'color_accent']) if (k in b) up.run(k, String(b[k]).toLowerCase());
  })();
  res.json({ ok: true });
}));
admin.put('/password', wrap((req, res) => {
  const { current, next } = req.body || {};
  const a = db.prepare('SELECT * FROM admins WHERE id=?').get(req.admin.id);
  if (!bcrypt.compareSync(String(current || ''), a.hash)) return res.status(400).json({ error: 'Aktuelles Passwort ist falsch.' });
  if (String(next || '').length < 8) return res.status(400).json({ error: 'Das neue Passwort muss mindestens 8 Zeichen haben.' });
  db.prepare('UPDATE admins SET hash=? WHERE id=?').run(bcrypt.hashSync(next, 10), a.id);
  res.json({ ok: true });
}));

// Inhalte: Kundenstimmen & FAQ
const ITEM_TYPES = ['testimonial', 'faq'];
admin.get('/items/:type', wrap((req, res) => {
  if (!ITEM_TYPES.includes(req.params.type)) return res.status(404).json({ error: 'Unbekannt' });
  res.json(db.prepare('SELECT * FROM items WHERE type=? ORDER BY sort,id').all(req.params.type));
}));
admin.post('/items/:type', wrap((req, res) => {
  if (!ITEM_TYPES.includes(req.params.type)) return res.status(404).json({ error: 'Unbekannt' });
  const title = str(req.body?.title, 150), body = str(req.body?.body, 1500);
  if (!title) return res.status(400).json({ error: 'Bitte ausfüllen.' });
  const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 n FROM items WHERE type=?').get(req.params.type).n;
  res.status(201).json({ id: db.prepare('INSERT INTO items(type,title,body,sort) VALUES (?,?,?,?)').run(req.params.type, title, body, sort).lastInsertRowid });
}));
admin.put('/items/:id', wrap((req, res) => {
  const title = str(req.body?.title, 150), body = str(req.body?.body, 1500);
  if (!title) return res.status(400).json({ error: 'Bitte ausfüllen.' });
  db.prepare('UPDATE items SET title=?, body=? WHERE id=?').run(title, body, req.params.id);
  res.json({ ok: true });
}));
admin.delete('/items/:id', wrap((req, res) => {
  db.prepare('DELETE FROM items WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// Bilder (Client verkleinert vorab; hier wird Typ und Größe geprüft)
const IMAGE_KINDS = ['about_image', 'hero_image'];
const MAGIC = [['jpg', [0xff, 0xd8, 0xff]], ['png', [0x89, 0x50, 0x4e, 0x47]], ['webp', [0x52, 0x49, 0x46, 0x46]]];
function removeImage(kind) {
  const old = getSettings()[kind];
  if (old && old.startsWith('/uploads/')) fs.rmSync(path.join(UPLOAD_DIR, path.basename(old)), { force: true });
  db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(kind, '');
}
app.post('/api/admin/upload/:kind', express.json({ limit: '8mb' }), requireAdmin, wrap((req, res) => {
  if (!IMAGE_KINDS.includes(req.params.kind)) return res.status(404).json({ error: 'Unbekannt' });
  const m = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''));
  if (!m) return res.status(400).json({ error: 'Bitte ein Bild (JPG, PNG oder WebP) wählen.' });
  const buf = Buffer.from(m[1], 'base64');
  const type = MAGIC.find(([, sig]) => sig.every((b, i) => buf[i] === b));
  if (!type || buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Ungültiges oder zu großes Bild.' });
  const name = `${req.params.kind}-${crypto.randomBytes(5).toString('hex')}.${type[0]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  removeImage(req.params.kind);
  db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(req.params.kind, '/uploads/' + name);
  res.json({ ok: true, url: '/uploads/' + name });
}));
admin.delete('/upload/:kind', wrap((req, res) => {
  if (!IMAGE_KINDS.includes(req.params.kind)) return res.status(404).json({ error: 'Unbekannt' });
  removeImage(req.params.kind);
  res.json({ ok: true });
}));

// CSV-Export
admin.get('/export.csv', wrap((req, res) => {
  const cell = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return `"${v.replace(/"/g, '""')}"`; };
  const rows = db.prepare(`SELECT a.date,a.start,a.end,s.name AS service,a.name,a.email,a.phone,a.status,a.message,a.created_at
    FROM appointments a JOIN services s ON s.id=a.service_id ORDER BY a.date,a.start`).all();
  const head = ['Datum', 'Beginn', 'Ende', 'Leistung', 'Name', 'E-Mail', 'Telefon', 'Status', 'Nachricht', 'Angelegt'];
  const csv = '\ufeff' + [head, ...rows.map(r => Object.values(r))].map(r => r.map(cell).join(';')).join('\r\n');
  res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="termine-${todayStr()}.csv"`).send(csv);
}));

// ---------- static ----------
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Serverfehler' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Praxis-Website läuft auf http://localhost:${port}  (Admin: /admin)`));
