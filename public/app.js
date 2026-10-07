(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const longDate = s => { const d = new Date(s + 'T12:00:00'); return `${DAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

  // Header, Menü, Reveal
  const header = $('header.site');
  addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 8), { passive: true });
  const burger = $('.burger'), menu = $('#menu');
  burger.onclick = () => burger.setAttribute('aria-expanded', menu.classList.toggle('open'));
  menu.onclick = e => { if (e.target.closest('a')) { menu.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); } };
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .08 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  $('#year').textContent = new Date().getFullYear();

  const ICONS = [
    '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>',
    '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.5 3.5-7 8-7s8 2.500 8 7"/>',
    '<path d="M9 11V5a2 2 0 0 1 4 0v5m0 0V4a2 2 0 0 1 4 0v8m-8 0V7a2 2 0 0 0-4 0v8a7 7 0 0 0 14 0v-3"/>',
    '<path d="M12 3a7 7 0 0 0-4 12.7V19h8v-3.300A7 7 0 0 0 12 3zM9 22h6"/>',
  ];

  function applyContent(d) {
    const c = d.content;
    document.querySelectorAll('[data-c]').forEach(el => {
      const v = c[el.dataset.c] ?? '';
      if (el.hasAttribute('data-em')) el.innerHTML = esc(v).replace(/\*([^*]+)\*/g, '<em>$1</em>');
      else el.textContent = v;
    });
    $('#trust').innerHTML = c.trust.split('\n').filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('');
    $('#steps').innerHTML = [1, 2, 3].map(i => `<div class="step"><h3>${esc(c['step' + i + '_t'])}</h3><p>${esc(c['step' + i + '_x'])}</p></div>`).join('');
    $('#aboutText').innerHTML = c.about_text.split(/\n\s*\n/).map((p, i) => `<p${i ? '' : ' class="lead"'}>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    if (c.about_image) $('#portrait').innerHTML = `<img src="${esc(c.about_image)}" alt="${esc(d.settings.therapist)}" loading="lazy">`;
    if (c.hero_image) $('#heroArt').innerHTML = `<img class="hero-img" src="${esc(c.hero_image)}" alt="">`;
    if (d.testimonials.length) {
      $('#stimmen').hidden = false;
      $('#testimonials').innerHTML = d.testimonials.map(t => `<figure class="card quote"><blockquote>„${esc(t.body)}“</blockquote><figcaption>${esc(t.title)}</figcaption></figure>`).join('');
    }
    if (d.faqs.length) {
      $('#faq').hidden = false;
      $('#faqList').innerHTML = d.faqs.map(f => `<details><summary>${esc(f.title)}</summary><p>${esc(f.body)}</p></details>`).join('');
    }
  }

  let data, state = { service: null, date: null, time: null, month: new Date(), avail: {}, step: 1 };

  fetch('/api/public').then(r => r.json()).then(d => {
    data = d;
    document.querySelectorAll('[data-bind]').forEach(el => { el.textContent = d.settings[el.dataset.bind] ?? ''; });
    document.querySelectorAll('[data-bind-href]').forEach(el => {
      const v = d.settings[el.dataset.bind]; el.href = el.dataset.bindHref === 'tel' ? 'tel:' + v.replace(/[^\d+]/g, '') : 'mailto:' + v;
    });
    document.title = `${d.settings.practice_name} – Termin online buchen`;
    applyContent(d);
    $('#services').innerHTML = d.services.map((s, i) => `
      <article class="card"><div class="ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[i % ICONS.length]}</svg></div>
        <h3>${esc(s.name)}</h3><p>${esc(s.description)}</p>
        <div class="meta"><span class="pill">${s.duration} Min.</span>${s.price ? `<span class="pill">${esc(s.price)}</span>` : ''}</div></article>`).join('');
    const today = new Date().getDay();
    $('#hours').innerHTML = d.hours.map(h => `<tr class="${h.weekday === today ? 'today' : ''}"><td>${DAYS[h.weekday]}</td><td>${h.enabled ? `${h.open} – ${h.close} Uhr` : 'geschlossen'}</td></tr>`).join('');
    render();
  });

  // ---------- Wizard ----------
  const wiz = $('#wizard');
  async function loadMonth() {
    const y = state.month.getFullYear(), m = state.month.getMonth();
    const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
    const r = await fetch(`/api/availability?service=${state.service.id}&from=${iso(first)}&days=${days}`);
    state.avail = await r.json();
  }

  function progress() { return `<div class="progress">${[1, 2, 3].map(i => `<i class="${i <= state.step ? 'on' : ''}"></i>`).join('')}</div>`; }

  function render(err) {
    if (!data) return;
    if (state.step === 1) {
      wiz.innerHTML = progress() + `<h3>1 · Was möchten Sie buchen?</h3><div class="opts">${data.services.map(s => `
        <button class="opt ${state.service?.id === s.id ? 'sel' : ''}" data-id="${s.id}"><span><strong>${esc(s.name)}</strong><small>${esc(s.price)}</small></span><span class="dur">${s.duration} Min.</span></button>`).join('')}</div>
        <div class="wiz-nav"><span></span><button class="btn" id="next" ${state.service ? '' : 'disabled'}>Weiter →</button></div>`;
      wiz.querySelectorAll('.opt').forEach(b => b.onclick = () => { state.service = data.services.find(s => s.id == b.dataset.id); state.date = state.time = null; render(); });
      $('#next').onclick = async () => { state.step = 2; state.month = new Date(); await loadMonth(); render(); };
    } else if (state.step === 2) {
      const y = state.month.getFullYear(), m = state.month.getMonth(), now = new Date();
      const lead = (new Date(y, m, 1).getDay() + 6) % 7, total = new Date(y, m + 1, 0).getDate();
      const canPrev = y > now.getFullYear() || m > now.getMonth();
      const maxD = new Date(); maxD.setDate(maxD.getDate() + data.settings.max_days_ahead);
      const canNext = new Date(y, m + 1, 1) <= maxD;
      let cells = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => `<div class="dow">${d}</div>`).join('') + '<span></span>'.repeat(lead);
      for (let d = 1; d <= total; d++) {
        const ds = `${y}-${pad(m + 1)}-${pad(d)}`, has = (state.avail[ds] || []).length > 0;
        cells += `<button data-d="${ds}" class="${has ? 'has' : ''} ${state.date === ds ? 'sel' : ''} ${ds === iso(now) ? 'today' : ''}" ${has ? '' : 'disabled'}>${d}</button>`;
      }
      const times = state.date ? state.avail[state.date] || [] : [];
      wiz.innerHTML = progress() + `<h3>2 · Wann passt es Ihnen?</h3><p class="hint">${esc(state.service.name)} · ${state.service.duration} Min.</p>
        <div class="dt"><div><div class="cal-head"><button class="icon-btn" id="prev" ${canPrev ? '' : 'disabled'} aria-label="Voriger Monat">‹</button><strong>${MONTHS[m]} ${y}</strong><button class="icon-btn" id="nextm" ${canNext ? '' : 'disabled'} aria-label="Nächster Monat">›</button></div><div class="cal">${cells}</div></div>
        <div><strong>${state.date ? longDate(state.date) : 'Bitte Tag wählen'}</strong>
          ${state.date ? `<div class="times">${times.map(t => `<button data-t="${t}" class="${state.time === t ? 'sel' : ''}">${t}</button>`).join('')}</div>` : '<p class="hint">Grün markierte Tage haben freie Termine.</p>'}</div></div>
        <div class="wiz-nav"><button class="btn ghost" id="back">← Zurück</button><button class="btn" id="next" ${state.time ? '' : 'disabled'}>Weiter →</button></div>`;
      $('#prev').onclick = async () => { state.month = new Date(y, m - 1, 1); await loadMonth(); render(); };
      $('#nextm').onclick = async () => { state.month = new Date(y, m + 1, 1); await loadMonth(); render(); };
      wiz.querySelectorAll('.cal [data-d]').forEach(b => b.onclick = () => { state.date = b.dataset.d; state.time = null; render(); });
      wiz.querySelectorAll('.times [data-t]').forEach(b => b.onclick = () => { state.time = b.dataset.t; render(); });
      $('#back').onclick = () => { state.step = 1; render(); };
      $('#next').onclick = () => { state.step = 3; render(); };
    } else if (state.step === 3) {
      wiz.innerHTML = progress() + `<h3>3 · Ihre Angaben</h3>
        <div class="summary"><strong>${esc(state.service.name)}</strong><br>${longDate(state.date)}, ${state.time} Uhr (${state.service.duration} Min.)</div>
        ${err ? `<div class="error" role="alert">${esc(err)}</div>` : ''}
        <form id="f" novalidate>
          <div class="row2"><div class="field"><label for="n">Name *</label><input id="n" name="name" autocomplete="name" required></div>
          <div class="field"><label for="p">Telefon</label><input id="p" name="phone" type="tel" autocomplete="tel"></div></div>
          <div class="field"><label for="e">E-Mail *</label><input id="e" name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="m">Nachricht (optional)</label><textarea id="m" name="message" placeholder="z. B. Anliegen, Alter des Kindes, Verordnung vorhanden?"></textarea></div>
          <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
          <label class="check"><input type="checkbox" name="privacy"><span>Ich habe die <a href="/datenschutz" target="_blank">Datenschutzerklärung</a> gelesen und stimme der Verarbeitung meiner Daten zur Terminvergabe zu. *</span></label>
          <div class="wiz-nav"><button type="button" class="btn ghost" id="back">← Zurück</button><button class="btn" type="submit">Verbindlich buchen</button></div>
        </form>`;
      $('#back').onclick = () => { state.step = 2; render(); };
      $('#f').onsubmit = async e => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target));
        const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
        const r = await fetch('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...fd, privacy: !!fd.privacy, service_id: state.service.id, date: state.date, start: state.time }) });
        const j = await r.json();
        if (r.ok) { state.done = { ...j, email: fd.email }; state.step = 4; render(); return; }
        if (r.status === 409) { state.step = 2; state.time = null; await loadMonth(); render(); const h = wiz.querySelector('h3'); h.insertAdjacentHTML('afterend', `<div class="error">${esc(j.error)}</div>`); return; }
        render(j.error);
        // Eingaben wiederherstellen
        for (const [k, v] of Object.entries(fd)) { const el = $(`#f [name=${k}]`); if (el && el.type !== 'checkbox') el.value = v; }
      };
    } else {
      const d = state.done, confirmed = d.status === 'confirmed';
      wiz.innerHTML = `<div class="done"><div class="tick">✓</div><h3>${confirmed ? 'Ihr Termin ist bestätigt!' : 'Vielen Dank – Ihre Anfrage ist eingegangen!'}</h3>
        <p><strong>${esc(d.service)}</strong><br>${longDate(d.date)}, ${d.start}–${d.end} Uhr</p>
        <p class="hint">${confirmed ? '' : 'Wir bestätigen Ihren Termin schnellstmöglich. '}Bitte bringen Sie – falls vorhanden – Ihre ärztliche Verordnung mit.</p>
        <p><a href="/termin?t=${d.token}">Termin verwalten oder absagen</a><br><span class="hint">Speichern Sie diesen Link – er ist Ihr persönlicher Zugang.</span></p>
        <button class="btn ghost" id="again">Weiteren Termin buchen</button></div>`;
      $('#again').onclick = () => { state = { service: null, date: null, time: null, month: new Date(), avail: {}, step: 1 }; render(); };
    }
  }
})();
