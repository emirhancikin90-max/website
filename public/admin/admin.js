(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'], DAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const fmtDate = s => { const d = new Date(s + 'T12:00:00'); return `${DAYS[d.getDay()]}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
  const STATUS = { pending: 'Angefragt', confirmed: 'Bestätigt', cancelled: 'Abgesagt' };

  async function api(path, method = 'GET', body) {
    const r = await fetch('/api/admin' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/login') { showLogin(); throw new Error('auth'); }
    if (!r.ok) { toast(j.error || 'Fehler', true); throw new Error(j.error); }
    return j;
  }
  let tt;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }
  function modal(html, onReady) { const d = $('#dlg'); d.innerHTML = html; d.showModal(); onReady?.(d); d.querySelector('[data-close]')?.addEventListener('click', () => d.close()); return d; }

  // ---------- Auth ----------
  function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const err = $('#loginErr'); err.classList.add('hidden');
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
    const j = await r.json();
    if (!r.ok) { err.textContent = j.error; err.classList.remove('hidden'); return; }
    e.target.reset(); boot();
  };
  $('#logout').onclick = async () => { await fetch('/api/admin/logout', { method: 'POST' }); showLogin(); };
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
  $('#side').onclick = e => { if (e.target.closest('a') || e.target === $('#side')) $('#side').classList.remove('open'); };

  // ---------- Router ----------
  const views = { dashboard: ['Übersicht', dashboard], termine: ['Termine', termine], website: ['Website gestalten', website], leistungen: ['Leistungen', leistungen], zeiten: ['Zeiten & Urlaub', zeiten], einstellungen: ['Einstellungen', einstellungen] };
  async function route() {
    const v = (location.hash.slice(1) in views) ? location.hash.slice(1) : 'dashboard';
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.v === v));
    $('#title').textContent = views[v][0];
    $('#view').innerHTML = '<p class="muted">Lade …</p>';
    try { await views[v][1](); } catch (e) { if (e.message !== 'auth') console.error(e); }
    refreshBadge();
  }
  addEventListener('hashchange', route);
  async function refreshBadge() {
    try { const d = await api('/dashboard'); const b = $('#badge'); b.textContent = d.pending; b.classList.toggle('hidden', !d.pending); } catch {}
  }
  async function boot() {
    try { const me = await api('/me'); $('#who').textContent = me.username; } catch { return; }
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); route();
  }

  // ---------- Dashboard ----------
  async function dashboard() {
    const d = await api('/dashboard');
    const max = Math.max(1, ...d.week.map(w => w.count));
    $('#view').innerHTML = `
      <div class="stats">
        <div class="stat ${d.pending ? 'hl' : ''}"><span class="muted">Offene Anfragen</span><b>${d.pending}</b></div>
        <div class="stat"><span class="muted">Heute</span><b>${d.today}</b></div>
        <div class="stat"><span class="muted">Kommende Termine</span><b>${d.upcoming}</b></div>
        <div class="stat"><span class="muted">Patient:innen gesamt</span><b>${d.patients}</b></div>
      </div>
      <div class="card"><h2>Nächste 7 Tage</h2><div class="bars">${d.week.map((w, i) => `<div><em>${w.count}</em><span class="${w.count ? 'on' : ''}" style="height:${w.count / max * 100}%"></span>${i ? DAYS[new Date(w.date + 'T12:00').getDay()] : 'Heute'}</div>`).join('')}</div></div>
      <div class="card"><h2>Anstehende Termine</h2>${d.next.length ? `<div class="tbl-wrap"><table><tbody>${d.next.map(a => `<tr><td><strong>${fmtDate(a.date)}</strong><div class="sub">${a.start}–${a.end} Uhr</div></td><td>${esc(a.name)}<div class="sub">${esc(a.service)}</div></td><td><span class="status ${a.status}">${STATUS[a.status]}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Keine anstehenden Termine.</p>'}</div>`;
  }

  // ---------- Termine ----------
  let filter = { status: '', q: '', from: iso(new Date()), to: '' };
  let mode = 'list', weekStart = mondayOf(new Date());
  function mondayOf(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  async function termine() {
    if (mode === 'week') return week();
    return list();
  }
  const modeSwitch = () => `<div class="seg"><button class="${mode === 'list' ? 'on' : ''}" data-mode="list">Liste</button><button class="${mode === 'week' ? 'on' : ''}" data-mode="week">Woche</button></div>`;
  const bindMode = () => document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; route(); });
  async function week() {
    const end = new Date(weekStart); end.setDate(end.getDate() + 6);
    const rows = (await api(`/appointments?from=${iso(weekStart)}&to=${iso(end)}`)).filter(a => a.status !== 'cancelled');
    const days = [...Array(7)].map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
    $('#view').innerHTML = `<div class="toolbar">${modeSwitch()}<button class="btn ghost" id="wp">‹</button><button class="btn ghost" id="wt">Heute</button><button class="btn ghost" id="wn">›</button>
      <strong style="flex:1;align-self:center">${fmtDate(iso(days[0]))} – ${fmtDate(iso(days[6]))}</strong><button class="btn" id="newAppt">+ Termin anlegen</button></div>
      <div class="week">${days.map(d => { const ds = iso(d), list = rows.filter(a => a.date === ds).sort((a, b) => a.start.localeCompare(b.start));
        return `<div class="wday ${ds === iso(new Date()) ? 'today' : ''}"><h3>${DAYS[d.getDay()]} <span>${pad(d.getDate())}.${pad(d.getMonth() + 1)}.</span></h3>
        ${list.map(a => `<div class="wappt ${a.status}" title="${esc(a.service)}"><b>${a.start}–${a.end}</b>${esc(a.name)}<small>${esc(a.service)}</small></div>`).join('') || '<p class="muted small">–</p>'}</div>`; }).join('')}</div>`;
    bindMode();
    const shift = n => { weekStart.setDate(weekStart.getDate() + n); route(); };
    $('#wp').onclick = () => shift(-7); $('#wn').onclick = () => shift(7); $('#wt').onclick = () => { weekStart = mondayOf(new Date()); route(); };
    $('#newAppt').onclick = newAppt;
  }
  async function list() {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
    const rows = await api('/appointments?' + qs);
    $('#view').innerHTML = `
      <div class="toolbar">${modeSwitch()}
        <label>Status<select id="fStatus"><option value="">Alle</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${filter.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Von<input type="date" id="fFrom" value="${filter.from}"></label>
        <label>Bis<input type="date" id="fTo" value="${filter.to}"></label>
        <label class="grow">Suche<input id="fQ" placeholder="Name, E-Mail, Telefon" value="${esc(filter.q)}"></label>
        <a class="btn ghost" href="/api/admin/export.csv" style="margin-bottom:.9rem;text-decoration:none">CSV-Export</a>
        <button class="btn" id="newAppt" style="margin-bottom:.9rem">+ Termin anlegen</button>
      </div>
      <div class="card"><div class="tbl-wrap">${rows.length ? `<table><thead><tr><th>Termin</th><th>Patient:in</th><th>Leistung</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(a => `
        <tr><td><strong>${fmtDate(a.date)}</strong><div class="sub">${a.start}–${a.end} Uhr</div></td>
        <td>${esc(a.name)}<div class="sub"><a href="mailto:${esc(a.email)}">${esc(a.email)}</a>${a.phone ? ' · ' + esc(a.phone) : ''}</div>${a.message ? `<div class="sub">„${esc(a.message)}“</div>` : ''}</td>
        <td>${esc(a.service)}</td><td><span class="status ${a.status}">${STATUS[a.status]}</span></td>
        <td><div class="actions">
          ${a.status !== 'confirmed' ? `<button class="btn sm" data-st="confirmed" data-id="${a.id}">Bestätigen</button>` : ''}
          ${a.status !== 'cancelled' ? `<button class="btn sm ghost" data-st="cancelled" data-id="${a.id}">Absagen</button>` : ''}
          <button class="btn sm ghost" data-del="${a.id}" title="Löschen">🗑</button></div></td></tr>`).join('')}</tbody></table>` : '<p class="empty">Keine Termine gefunden.</p>'}</div></div>`;
    bindMode();
    let t;
    const apply = () => { filter = { status: $('#fStatus').value, from: $('#fFrom').value, to: $('#fTo').value, q: $('#fQ').value }; termine(); };
    ['#fStatus', '#fFrom', '#fTo'].forEach(s => $(s).onchange = apply);
    $('#fQ').oninput = () => { clearTimeout(t); t = setTimeout(async () => { apply(); }, 350); };
    if (filter.q) { const q = $('#fQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    document.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => { await api('/appointments/' + b.dataset.id, 'PATCH', { status: b.dataset.st }); toast('Status aktualisiert'); route(); });
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (confirm('Termin endgültig löschen?')) { await api('/appointments/' + b.dataset.del, 'DELETE'); toast('Gelöscht'); route(); } });
    $('#newAppt').onclick = newAppt;
  }
  async function newAppt() {
    const svcs = (await api('/services')).filter(s => s.active);
    modal(`<h2>Termin anlegen</h2><form id="nf">
      <label>Leistung<select name="service_id">${svcs.map(s => `<option value="${s.id}">${esc(s.name)} (${s.duration} Min.)</option>`).join('')}</select></label>
      <div class="grid2"><label>Datum<input type="date" name="date" value="${iso(new Date())}" required></label><label>Beginn<input type="time" name="start" value="09:00" required></label></div>
      <label>Name<input name="name" required></label>
      <div class="grid2"><label>E-Mail<input type="email" name="email"></label><label>Telefon<input name="phone"></label></div>
      <label>Notiz<textarea name="message" rows="2"></textarea></label>
      <div class="dlg-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button class="btn">Speichern</button></div></form>`,
      d => $('#nf').onsubmit = async e => { e.preventDefault(); await api('/appointments', 'POST', Object.fromEntries(new FormData(e.target))); d.close(); toast('Termin angelegt'); route(); });
  }

  // ---------- Leistungen ----------
  async function leistungen() {
    const list = await api('/services');
    $('#view').innerHTML = `<div class="toolbar"><span class="muted" style="flex:1">Diese Leistungen erscheinen auf der Website und in der Buchung.</span><button class="btn" id="add">+ Neue Leistung</button></div>
      <div class="card">${list.map(s => `<div class="list-row"><div><strong>${esc(s.name)}</strong> ${s.active ? '' : '<span class="status cancelled">inaktiv</span>'}<div class="sub muted small">${s.duration} Min. · ${esc(s.price) || '–'} · Reihenfolge ${s.sort}</div></div>
        <div class="actions"><button class="btn sm ghost" data-edit="${s.id}">Bearbeiten</button><button class="btn sm ghost" data-del="${s.id}">🗑</button></div></div>`).join('') || '<p class="empty">Noch keine Leistungen.</p>'}</div>`;
    const edit = s => modal(`<h2>${s ? 'Leistung bearbeiten' : 'Neue Leistung'}</h2><form id="sf">
      <label>Name<input name="name" required value="${esc(s?.name)}"></label>
      <label>Beschreibung<textarea name="description" rows="3">${esc(s?.description)}</textarea></label>
      <div class="grid2"><label>Dauer (Min.)<input type="number" name="duration" min="5" max="480" step="5" required value="${s?.duration ?? 45}"></label><label>Preis / Hinweis<input name="price" value="${esc(s?.price)}" placeholder="z. B. Kassenleistung"></label></div>
      <div class="grid2"><label>Reihenfolge<input type="number" name="sort" value="${s?.sort ?? list.length + 1}"></label><label class="switch" style="flex-direction:row;align-items:center;margin-top:1.4rem"><input type="checkbox" name="active" ${!s || s.active ? 'checked' : ''}> Aktiv (online buchbar)</label></div>
      <div class="dlg-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button class="btn">Speichern</button></div></form>`,
      d => $('#sf').onsubmit = async e => {
        e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.active = !!f.active;
        await api(s ? '/services/' + s.id : '/services', s ? 'PUT' : 'POST', f); d.close(); toast('Gespeichert'); route();
      });
    $('#add').onclick = () => edit();
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(list.find(s => s.id == b.dataset.edit)));
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Leistung löschen? Bereits gebuchte Leistungen werden nur deaktiviert.')) return;
      const r = await api('/services/' + b.dataset.del, 'DELETE'); toast(r.deactivated ? 'Deaktiviert (es existieren Termine)' : 'Gelöscht'); route();
    });
  }

  // ---------- Zeiten ----------
  async function zeiten() {
    const { hours, blocked } = await api('/schedule');
    $('#view').innerHTML = `
      <div class="card"><h2>Reguläre Öffnungszeiten</h2><p class="muted small">Innerhalb dieser Zeiten können Patient:innen online buchen.</p>
        <form id="hf">${hours.map(h => `<div class="hours-row"><strong>${DAYS_LONG[h.weekday]}</strong><label><input type="checkbox" data-k="enabled" ${h.enabled ? 'checked' : ''}> offen</label><input type="time" data-k="open" value="${h.open}"><input type="time" data-k="close" value="${h.close}"></div>`).join('')}
        <button class="btn" style="margin-top:.6rem">Speichern</button></form></div>
      <div class="card"><h2>Urlaub &amp; Feiertage (gesperrte Tage)</h2>
        <form id="bf" class="toolbar"><label>Datum<input type="date" name="date" min="${iso(new Date())}" required></label><label class="grow">Grund<input name="reason" placeholder="z. B. Urlaub, Feiertag"></label><button class="btn" style="margin-bottom:.9rem">Sperren</button></form>
        ${blocked.map(b => `<div class="list-row"><span><strong>${fmtDate(b.date)}</strong> <span class="muted">${esc(b.reason)}</span></span><button class="btn sm ghost" data-unb="${b.id}">Entfernen</button></div>`).join('') || '<p class="muted small">Keine gesperrten Tage.</p>'}</div>`;
    $('#hf').onsubmit = async e => {
      e.preventDefault();
      const rows = [...document.querySelectorAll('.hours-row')].map((r, i) => ({ weekday: hours[i].weekday,
        enabled: r.querySelector('[data-k=enabled]').checked, open: r.querySelector('[data-k=open]').value, close: r.querySelector('[data-k=close]').value }));
      await api('/hours', 'PUT', rows); toast('Öffnungszeiten gespeichert');
    };
    $('#bf').onsubmit = async e => { e.preventDefault(); await api('/blocked', 'POST', Object.fromEntries(new FormData(e.target))); toast('Tag gesperrt'); route(); };
    document.querySelectorAll('[data-unb]').forEach(b => b.onclick = async () => { await api('/blocked/' + b.dataset.unb, 'DELETE'); route(); });
  }

  // ---------- Einstellungen ----------
  async function einstellungen() {
    const s = await api('/settings');
    const f = (k, label, type = 'text') => `<label>${label}<input name="${k}" type="${type}" value="${esc(s[k])}"></label>`;
    $('#view').innerHTML = `
      <form class="card" id="sf"><h2>Praxisdaten</h2>
        <div class="grid2">${f('practice_name', 'Praxisname')}${f('therapist', 'Therapeut:in')}${f('phone', 'Telefon')}${f('email', 'E-Mail', 'email')}</div>${f('address', 'Adresse')}
        <h2 style="margin-top:.6rem">Terminbuchung</h2>
        <div class="grid2">
          <label>Zeitraster<select name="slot_step">${[15, 30, 45, 60].map(n => `<option ${s.slot_step == n ? 'selected' : ''} value="${n}">alle ${n} Min.</option>`).join('')}</select></label>
          ${f('lead_hours', 'Mindestvorlauf (Stunden)', 'number')}${f('max_days_ahead', 'Buchbar bis (Tage im Voraus)', 'number')}
          <label class="switch" style="flex-direction:row;align-items:center;margin-top:1.4rem"><input type="checkbox" name="auto_confirm" ${s.auto_confirm === '1' ? 'checked' : ''}> Termine automatisch bestätigen</label>
          <label class="switch" style="flex-direction:row;align-items:center"><input type="checkbox" name="notify" ${s.notify === '1' ? 'checked' : ''}> E-Mail-Benachrichtigungen senden</label>
          ${s.mail_enabled ? '' : '<p class="muted small" style="grid-column:1/-1;margin:0 0 1rem">E-Mail-Versand ist noch nicht eingerichtet: Setzen Sie beim Start die Variable <code>SMTP_URL</code> (siehe README).</p>'}
        </div><button class="btn">Speichern</button></form>
      <form class="card" id="pf"><h2>Passwort ändern</h2><div class="grid2"><label>Aktuelles Passwort<input type="password" name="current" autocomplete="current-password" required></label><label>Neues Passwort (min. 8 Zeichen)<input type="password" name="next" autocomplete="new-password" minlength="8" required></label></div><button class="btn">Passwort ändern</button></form>`;
    $('#sf').onsubmit = async e => {
      e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); v.auto_confirm = v.auto_confirm ? '1' : '0'; v.notify = v.notify ? '1' : '0';
      await api('/settings', 'PUT', v); toast('Einstellungen gespeichert');
    };
    $('#pf').onsubmit = async e => { e.preventDefault(); await api('/password', 'PUT', Object.fromEntries(new FormData(e.target))); e.target.reset(); toast('Passwort geändert'); };
  }

  // ---------- Website gestalten ----------
  const PRESETS = [
    ['Salbei', '#3f7d6b', '#e07a5f'], ['Ozean', '#2f6f9f', '#f2a65a'], ['Lavendel', '#7a62a8', '#f08fa0'],
    ['Beere', '#a8436a', '#e9a23b'], ['Sonne', '#d98a2b', '#3f8f8b'], ['Schiefer', '#4a5d6e', '#d96c5f'],
  ];
  const TEXT_FIELDS = [
    ['Startseite', [['hero_eyebrow', 'Kleine Zeile über der Überschrift'], ['hero_title', 'Überschrift (Wort mit *Sternchen* wird farbig)'], ['hero_text', 'Einleitung', 'area'], ['trust', 'Vorteile (eine pro Zeile)', 'area']]],
    ['Leistungen', [['services_title', 'Überschrift'], ['services_text', 'Untertitel']]],
    ['Ablauf', [['steps_title', 'Überschrift'], ['step1_t', 'Schritt 1 – Titel'], ['step1_x', 'Schritt 1 – Text', 'area'], ['step2_t', 'Schritt 2 – Titel'], ['step2_x', 'Schritt 2 – Text', 'area'], ['step3_t', 'Schritt 3 – Titel'], ['step3_x', 'Schritt 3 – Text', 'area']]],
    ['Über uns', [['about_title', 'Überschrift'], ['about_text', 'Text (Leerzeile = neuer Absatz)', 'area', 6]]],
  ];
  // Foto im Browser verkleinern, damit Uploads klein und schnell bleiben
  function resizeImage(file, max = 1400) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
      img.src = url;
    });
  }
  async function website() {
    const [s, testi, faqs] = await Promise.all([api('/settings'), api('/items/testimonial'), api('/items/faq')]);
    const field = ([k, label, type, rows]) => type === 'area'
      ? `<label>${label}<textarea name="${k}" rows="${rows || 2}">${esc(s[k])}</textarea></label>` : `<label>${label}<input name="${k}" value="${esc(s[k])}"></label>`;
    const itemCard = (type, title, hint, tl, bl) => `<div class="card"><div class="card-head"><h2>${title}</h2><button class="btn sm" data-add="${type}">+ Hinzufügen</button></div><p class="muted small">${hint}</p>
      ${(type === 'faq' ? faqs : testi).map(i => `<div class="list-row"><div><strong>${esc(i.title)}</strong><div class="muted small">${esc(i.body.slice(0, 90))}${i.body.length > 90 ? '…' : ''}</div></div><div class="actions"><button class="btn sm ghost" data-ie="${i.id}" data-type="${type}">Bearbeiten</button><button class="btn sm ghost" data-id="${i.id}" data-idel>🗑</button></div></div>`).join('') || '<p class="empty">Noch nichts vorhanden – der Bereich ist auf der Website ausgeblendet.</p>'}</div>`;
    const imgBox = (k, label, hint) => `<div class="imgbox"><div class="thumb">${s[k] ? `<img src="${esc(s[k])}" alt="">` : '<span class="muted small">Kein Foto</span>'}</div>
      <div><strong>${label}</strong><p class="muted small" style="margin:.2rem 0 .6rem">${hint}</p><input type="file" accept="image/*" data-up="${k}" hidden>
      <button class="btn sm" data-pick="${k}" type="button">Foto wählen</button> ${s[k] ? `<button class="btn sm ghost" data-rm="${k}" type="button">Entfernen</button>` : ''}</div></div>`;

    $('#view').innerHTML = `<p class="muted" style="margin-top:0">Hier ändern Sie alles, was Besucher:innen sehen. <a href="/" target="_blank">Website ansehen ↗</a></p>
      <form id="wf">
        <div class="card"><h2>Farben &amp; Schrift</h2>
          <p class="muted small">Ein Klick auf ein Farbschema genügt – oder wählen Sie eigene Farben.</p>
          <div class="presets">${PRESETS.map(([n, a, b]) => `<button type="button" class="preset" data-a="${a}" data-b="${b}"><span style="background:${a}"></span><span style="background:${b}"></span>${n}</button>`).join('')}</div>
          <div class="grid2" style="margin-top:1rem"><label>Hauptfarbe<input type="color" name="color_primary" value="${esc(s.color_primary)}"></label>
            <label>Akzentfarbe<input type="color" name="color_accent" value="${esc(s.color_accent)}"></label></div>
          <label style="max-width:280px">Schriftstil<select name="font"><option value="serif" ${s.font === 'serif' ? 'selected' : ''}>Klassisch (mit Serifen)</option><option value="sans" ${s.font === 'sans' ? 'selected' : ''}>Modern (serifenlos)</option></select></label>
          <div class="preview" id="pv"><span class="pv-btn">Termin buchen</span><span class="pv-acc"></span><strong class="pv-h">So sieht es aus</strong></div></div>
        ${TEXT_FIELDS.map(([t, fs]) => `<div class="card"><h2>Texte: ${t}</h2>${fs.map(field).join('')}</div>`).join('')}
        <div class="card"><h2>Rechtliches</h2><p class="muted small">Mit <code>## Überschrift</code> beginnen Sie einen neuen Abschnitt. Bitte lassen Sie die Texte rechtlich prüfen.</p>
          <label>Impressum<textarea name="impressum" rows="9">${esc(s.impressum)}</textarea></label>
          <label>Datenschutzerklärung<textarea name="datenschutz" rows="9">${esc(s.datenschutz)}</textarea></label></div>
        <div class="savebar"><span class="muted small">Änderungen an Farben, Texten und Rechtlichem werden erst mit „Speichern" übernommen.</span><button class="btn">Speichern</button></div>
      </form>
      <div class="card"><h2>Fotos</h2>${imgBox('hero_image', 'Titelbild (Startseite)', 'Ersetzt die Illustration oben rechts. Hochformat oder quadratisch passt am besten.')}${imgBox('about_image', 'Porträt (Über uns)', 'Ein freundliches Foto von Ihnen oder Ihrem Team.')}</div>
      ${itemCard('testimonial', 'Kundenstimmen', 'Name und Zitat – erscheinen als Karten auf der Website.')}
      ${itemCard('faq', 'Häufige Fragen (FAQ)', 'Frage und Antwort – erscheinen als aufklappbare Liste.')}`;

    const f = $('#wf'), updatePv = () => {
      $('#pv').style.setProperty('--p', f.color_primary.value); $('#pv').style.setProperty('--a', f.color_accent.value);
      $('#pv').style.fontFamily = f.font.value === 'sans' ? 'system-ui,sans-serif' : "Georgia,'Palatino Linotype',serif";
    };
    updatePv(); f.addEventListener('input', updatePv);
    document.querySelectorAll('.preset').forEach(b => b.onclick = () => { f.color_primary.value = b.dataset.a; f.color_accent.value = b.dataset.b; updatePv(); });
    f.onsubmit = async e => {
      e.preventDefault(); await api('/settings', 'PUT', Object.fromEntries(new FormData(f))); toast('Gespeichert – die Website ist aktualisiert');
    };
    document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => $(`[data-up=${b.dataset.pick}]`).click());
    document.querySelectorAll('[data-up]').forEach(inp => inp.onchange = async () => {
      if (!inp.files[0]) return;
      try { const data = await resizeImage(inp.files[0], inp.dataset.up === 'hero_image' ? 1200 : 1000); await api('/upload/' + inp.dataset.up, 'POST', { data }); toast('Foto gespeichert'); route(); }
      catch (e) { if (e.message !== 'auth') toast('Foto konnte nicht hochgeladen werden'); }
    });
    document.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { await api('/upload/' + b.dataset.rm, 'DELETE'); route(); });
    const editItem = (type, it) => modal(`<h2>${it ? 'Bearbeiten' : 'Neu hinzufügen'}</h2><form id="if">
      <label>${type === 'faq' ? 'Frage' : 'Name (z. B. „Familie M.")'}<input name="title" required value="${esc(it?.title)}"></label>
      <label>${type === 'faq' ? 'Antwort' : 'Zitat'}<textarea name="body" rows="4">${esc(it?.body)}</textarea></label>
      <div class="dlg-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button class="btn">Speichern</button></div></form>`,
      d => $('#if').onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
        await api(it ? '/items/' + it.id : '/items/' + type, it ? 'PUT' : 'POST', v); d.close(); route(); });
    document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => editItem(b.dataset.add));
    document.querySelectorAll('[data-ie]').forEach(b => b.onclick = () => editItem(b.dataset.type, (b.dataset.type === 'faq' ? faqs : testi).find(i => i.id == b.dataset.ie)));
    document.querySelectorAll('[data-idel]').forEach(b => b.onclick = async () => { if (confirm('Eintrag löschen?')) { await api('/items/' + b.dataset.id, 'DELETE'); route(); } });
  }

  boot();
})();
