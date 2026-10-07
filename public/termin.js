(() => {
  const box = document.getElementById('box'), t = new URLSearchParams(location.search).get('t') || '';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label = { pending: 'Angefragt – Bestätigung folgt', confirmed: 'Bestätigt', cancelled: 'Abgesagt' };
  async function load() {
    const r = await fetch('/api/booking/' + encodeURIComponent(t));
    if (!r.ok) { box.innerHTML = '<h3>Termin nicht gefunden</h3><p>Der Link ist ungültig.</p>'; return; }
    const a = await r.json();
    const [y, m, d] = a.date.split('-');
    box.innerHTML = `<h3>Ihr Termin</h3><p><strong>${esc(a.service)}</strong><br>${d}.${m}.${y}, ${a.start}–${a.end} Uhr<br>Status: <strong>${label[a.status]}</strong></p>
      ${a.status !== 'cancelled' ? '<button class="btn ghost" id="c">Termin absagen</button>' : '<a class="btn" href="/#termin">Neuen Termin buchen</a>'}`;
    const c = document.getElementById('c');
    if (c) c.onclick = async () => { if (confirm('Termin wirklich absagen?')) { await fetch(`/api/booking/${encodeURIComponent(t)}/cancel`, { method: 'POST' }); load(); } };
  }
  load();
})();
