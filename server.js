process.env.TZ = process.env.TZ || 'Europe/Berlin';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const { db, getSettings } = require('./db');

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
app.use(express.json({ limit: '50kb' }));

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

// ---------- public API ----------
const publicLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
const bookLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Zu viele Anfragen – bitte später erneut versuchen.' } });

app.get('/api/public', publicLimiter, wrap((req, res) => {
  const s = getSettings();
  res.json({
    settings: { practice_name: s.practice_name, therapist: s.therapist, phone: s.phone, email: s.email,
      address: s.address, max_days_ahead: Number(s.max_days_ahead), auto_confirm: s.auto_confirm === '1' },
    services: db.prepare('SELECT id,name,description,duration,price FROM services WHERE active=1 ORDER BY sort,id').all(),
    hours: db.prepare('SELECT weekday,enabled,open,close FROM hours ORDER BY (weekday+6)%7').all(),
  });
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

admin.get('/settings', (req, res) => res.json(getSettings()));
admin.put('/settings', wrap((req, res) => {
  const allowed = { practice_name: 100, therapist: 100, phone: 40, email: 150, address: 200,
    slot_step: 3, lead_hours: 3, max_days_ahead: 3, auto_confirm: 1 };
  const up = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)');
  db.transaction(() => {
    for (const [k, max] of Object.entries(allowed)) if (k in (req.body || {})) up.run(k, str(req.body[k], max));
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

// ---------- static ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Serverfehler' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Praxis-Website läuft auf http://localhost:${port}  (Admin: /admin)`));
