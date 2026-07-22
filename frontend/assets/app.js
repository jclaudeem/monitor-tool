// ── Auth helpers ──
const TOKEN_KEY = 'mt_token';
const USER_KEY  = 'mt_user';

function getToken()    { return localStorage.getItem(TOKEN_KEY) || ''; }
function getAuthUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  location.href = 'login.html';
}

function requireAuth() {
  if (!getToken()) { location.href = 'login.html'; return false; }
  const user = getAuthUser();
  if (user) {
    const el = (id) => document.getElementById(id);
    if (el('user-initial'))       el('user-initial').textContent       = user.username[0].toUpperCase();
    if (el('user-dropdown-name')) el('user-dropdown-name').textContent = user.username;
    if (el('user-dropdown-role')) el('user-dropdown-role').textContent = user.role === 'admin' ? 'Admin' : 'Viewer';
    if (user.role !== 'admin') {
      document.querySelectorAll('[data-admin-only]').forEach(e => e.style.display = 'none');
    }
  }
  return true;
}

function toggleUserMenu(event) {
  event && event.stopPropagation();
  document.getElementById('user-dropdown')?.classList.toggle('open');
}

document.addEventListener('click', () => {
  document.getElementById('user-dropdown')?.classList.remove('open');
});

// ── API helpers (all calls include X-Auth-Token) ──
const api = {
  _headers(json = false) {
    const h = { 'X-Auth-Token': getToken() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  },
  async _check(r) {
    if (r.status === 401) { logout(); throw new Error('Unauthorized'); }
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Request failed'); }
    return r.json();
  },
  async get(path)         { return this._check(await fetch(path, { headers: this._headers() })); },
  async post(path, data)  { return this._check(await fetch(path, { method: 'POST',   headers: this._headers(true), body: JSON.stringify(data) })); },
  async put(path, data)   { return this._check(await fetch(path, { method: 'PUT',    headers: this._headers(true), body: JSON.stringify(data) })); },
  async del(path)         { return this._check(await fetch(path, { method: 'DELETE', headers: this._headers() })); },
  // For public endpoints (login, setup) that don't need auth header
  async postPublic(path, data) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Request failed'); }
    return r.json();
  }
};

// ── Formatters ──
function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Math.floor((Date.now() - new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'))) / 1000);
  if (diff < 5)    return 'just now';
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatResponseTime(ms) {
  if (ms === null || ms === undefined) return '—';
  return ms < 1 ? '<1 ms' : `${Math.round(ms)} ms`;
}

function deviceTypeIcon(type) {
  return {
    router:   'fa-solid fa-route',
    switch:   'fa-solid fa-network-wired',
    firewall: 'fa-solid fa-shield-halved',
    server:   'fa-solid fa-server',
    device:   'fa-solid fa-microchip',
  }[type] || 'fa-solid fa-microchip';
}

function statusBadgeHtml(status) {
  const s = status || 'unknown';
  return `<span class="status-badge ${s}">${s === 'up' ? '●' : s === 'down' ? '●' : '○'} ${s.charAt(0).toUpperCase() + s.slice(1)}</span>`;
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Toast ──
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

// ── Active nav ──
document.querySelectorAll('.nav-link').forEach(link => {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  if (link.getAttribute('href') === page) link.classList.add('active');
});
