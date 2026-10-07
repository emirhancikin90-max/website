(() => {
  const el = document.getElementById('text');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  fetch('/api/legal/' + el.dataset.page).then(r => r.json()).then(({ text }) => {
    el.innerHTML = String(text).split(/\n\s*\n/).map(b => {
      const lines = b.split('\n'); let out = '', buf = [];
      const flush = () => { if (buf.length) out += `<p>${buf.map(esc).join('<br>')}</p>`; buf = []; };
      for (const l of lines) { if (l.startsWith('## ')) { flush(); out += `<h2>${esc(l.slice(3))}</h2>`; } else buf.push(l); }
      flush(); return out;
    }).join('');
  });
})();
