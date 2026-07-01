// Shared API helpers
const api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, data) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Request failed'); }
    return r.json();
  },
  async put(path, data) {
    const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Request failed'); }
    return r.json();
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Request failed'); }
    return r.json();
  }
};

// Formatters
function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Math.floor((Date.now() - new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'))) / 1000);
  if (diff < 5)   return 'just now';
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatResponseTime(ms) {
  if (ms === null || ms === undefined) return '—';
  return ms < 1 ? '<1 ms' : `${Math.round(ms)} ms`;
}

function deviceTypeIcon(type) {
  const icons = {
    router:   'fa-solid fa-route',
    switch:   'fa-solid fa-network-wired',
    firewall: 'fa-solid fa-shield-halved',
    server:   'fa-solid fa-server',
    device:   'fa-solid fa-microchip',
  };
  return icons[type] || icons.device;
}

function statusBadgeHtml(status) {
  const s = status || 'unknown';
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  const dot = s === 'up' ? '●' : s === 'down' ? '●' : '○';
  return `<span class="status-badge ${s}">${dot} ${label}</span>`;
}

// Toast notifications
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

function showToast(message, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  toastContainer.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// Mark active nav link
document.querySelectorAll('.nav-link').forEach(link => {
  if (link.getAttribute('href') === window.location.pathname.split('/').pop() ||
      (window.location.pathname.endsWith('/') && link.getAttribute('href') === 'index.html')) {
    link.classList.add('active');
  }
});
