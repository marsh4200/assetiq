/* ============================================================ AssetIQ ===== */
let TOKEN = localStorage.getItem('assetiq_token') || '';
let ME = null;

const API = (p, opt = {}) => {
  opt.headers = Object.assign({}, opt.headers, TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {});
  return fetch('/api' + p, opt).then(async r => {
    if (r.status === 401) { clearToken(); showLogin(); throw new Error('Session expired'); }
    if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch (e) {} throw new Error(m); }
    return r.status === 204 ? null : r.json();
  });
};
function setToken(t) { TOKEN = t; localStorage.setItem('assetiq_token', t); }
function clearToken() { TOKEN = ''; localStorage.removeItem('assetiq_token'); }
const $  = s => document.querySelector(s);
const esc = s => (s ?? '').toString().replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CATS = {
  licence: 'Licence', fire_extinguisher: 'Fire Extinguisher', software: 'Software',
  antivirus: 'Antivirus', vehicle: 'Vehicle', machine: 'Machine Service',
  certificate: 'Certificate', other: 'Other',
};
const catLabel = c => CATS[c] || 'Other';

let settings = { business_name: 'ARSmartHome', notify_lead_days: '60', theme: 'dark' };

/* --------------------------------------------------------------- nav ------ */
function go(tab) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
  $('#view-' + tab).classList.add('active');
  document.querySelector(`.tabs button[data-tab="${tab}"]`).classList.add('active');
  window.scrollTo(0, 0);
  if (tab === 'dashboard')  loadDashboard();
  if (tab === 'assets')     loadAssets();
  if (tab === 'compliance') loadComp();
  if (tab === 'settings')   loadSettings();
}

/* ------------------------------------------------------------- toast ------ */
let toastT;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show ' + type;
  clearTimeout(toastT);
  toastT = setTimeout(() => t.className = 'toast', 2600);
}

/* ------------------------------------------------------------- modal ------ */
function closeModal() { $('#modalBg').classList.remove('show'); }
$('#modalBg').addEventListener('click', e => { if (e.target.id === 'modalBg') closeModal(); });

/* ----------------------------------------------------------- helpers ------ */
function daysBadge(item) {
  const d = item.days_remaining;
  if (d === null || d === undefined) return '';
  const cls = item.status;
  let txt;
  if (d < 0) txt = `Overdue ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'}`;
  else if (d === 0) txt = 'Due today';
  else txt = `${d} day${d === 1 ? '' : 's'} left`;
  return `<span class="when ${cls}">${txt}</span>`;
}

/* ---------------------------------------------------------- dashboard ----- */
async function loadDashboard() {
  const [notif, assets] = await Promise.all([
    API('/notifications'), API('/assets'),
  ]);
  $('#statExpired').textContent  = notif.expired;
  $('#statExpiring').textContent = notif.expiring;
  $('#statAssets').textContent   = assets.length;
  const months = Math.round(notif.lead_days / 30);
  $('#leadSub').textContent = `Alerts within ${notif.lead_days} days (~${months} month${months === 1 ? '' : 's'})`;

  const list = $('#alertList');
  if (!notif.items.length) {
    list.innerHTML = emptyState('check', 'All clear', 'Nothing is due within your lead time.');
    return;
  }
  list.innerHTML = notif.items.map(compCard).join('');
}

/* ------------------------------------------------------------ assets ------ */
async function loadAssets() {
  const q = $('#assetSearch').value.trim();
  const rows = await API('/assets' + (q ? '?q=' + encodeURIComponent(q) : ''));
  $('#assetCountSub').textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}`;
  const list = $('#assetList');
  if (!rows.length) {
    list.innerHTML = emptyState('box', q ? 'No matches' : 'No assets yet',
      q ? 'Try a different search.' : 'Add your first asset to start the register.');
    return;
  }
  list.innerHTML = rows.map(a => `
    <div class="card asset">
      <div class="tag">${String(a.id).padStart(3, '0')}</div>
      <div class="meta">
        <div class="name">${esc(a.name)}</div>
        ${a.description ? `<div class="desc">${esc(a.description)}</div>` : ''}
        <div class="chips">
          ${a.category ? `<span class="chip">${esc(a.category)}</span>` : ''}
          ${a.location ? `<span class="chip">📍 ${esc(a.location)}</span>` : ''}
          ${a.assigned_to ? `<span class="chip">${esc(a.assigned_to)}</span>` : ''}
          ${a.serial_number ? `<span class="chip"><span class="mono">${esc(a.serial_number)}</span></span>` : ''}
        </div>
      </div>
      <div class="rowactions">
        <button class="iconbtn" onclick='openAsset(${a.id})' title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>
      </div>
    </div>`).join('');
}

function openAsset(id) {
  const editing = id != null;
  const get = editing ? API('/assets').then(r => r.find(x => x.id === id)) : Promise.resolve({});
  get.then(a => {
    a = a || {};
    $('#modal').innerHTML = `
      <div class="mhead">
        <h3>${editing ? 'Edit asset #' + String(id).padStart(3, '0') : 'New asset'}</h3>
        <button class="iconbtn" onclick="closeModal()">✕</button>
      </div>
      <div class="mbody">
        <div class="field"><label>Name</label><input id="f_name" value="${esc(a.name)}" placeholder="e.g. Office chair – Roxanne"></div>
        <div class="field"><label>Description</label><input id="f_description" value="${esc(a.description)}"></div>
        <div class="grid2">
          <div class="field"><label>Category</label><input id="f_category" value="${esc(a.category)}" placeholder="Furniture / Tool…"></div>
          <div class="field"><label>Location</label><input id="f_location" value="${esc(a.location)}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Serial number</label><input id="f_serial_number" value="${esc(a.serial_number)}"></div>
          <div class="field"><label>Assigned to</label><input id="f_assigned_to" value="${esc(a.assigned_to)}"></div>
        </div>
        <div class="field"><label>Notes</label><textarea id="f_notes">${esc(a.notes)}</textarea></div>
      </div>
      <div class="mfoot">
        ${editing ? `<button class="btn danger" onclick="deleteAsset(${id})">Delete</button>` : ''}
        <button class="btn" onclick="saveAsset(${editing ? id : 'null'})">Save</button>
      </div>`;
    $('#modalBg').classList.add('show');
    setTimeout(() => $('#f_name').focus(), 60);
  });
}

async function saveAsset(id) {
  const body = {};
  ['name', 'description', 'category', 'location', 'serial_number', 'assigned_to', 'notes']
    .forEach(k => body[k] = $('#f_' + k).value.trim());
  if (!body.name) { toast('Name is required', 'err'); return; }
  try {
    await API(id ? '/assets/' + id : '/assets',
      { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeModal(); toast(id ? 'Asset updated' : 'Asset added', 'ok'); loadAssets();
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteAsset(id) {
  if (!confirm('Delete this asset? Its number stays retired and won\'t be reused.')) return;
  try { await API('/assets/' + id, { method: 'DELETE' }); closeModal(); toast('Asset deleted', 'ok'); loadAssets(); }
  catch (e) { toast(e.message, 'err'); }
}

function printLabels() {
  API('/assets').then(rows => {
    if (!rows.length) { toast('No assets to print', 'err'); return; }
    $('#labelSheet').innerHTML = rows.map(a =>
      `<div class="label"><div class="no">${String(a.id).padStart(3, '0')}</div><div class="nm">${esc(a.name)}</div></div>`
    ).join('');
    window.print();
  });
}

/* -------------------------------------------------------- compliance ------ */
function compCard(c) {
  const isMachine = c.category === 'machine';
  const dateBlocks = [];
  if (c.expiry_date) dateBlocks.push(
    `<div><div class="k">Expires</div><div class="v">${esc(c.expiry_date)}</div>${daysBadge({ days_remaining: c.days_until_expiry, status: c.status })}</div>`);
  if (c.last_service_date) dateBlocks.push(
    `<div><div class="k">Last service</div><div class="v">${esc(c.last_service_date)}</div></div>`);
  if (c.next_service_date) dateBlocks.push(
    `<div><div class="k">Next service</div><div class="v">${esc(c.next_service_date)}</div>${daysBadge({ days_remaining: c.days_until_service, status: c.status })}</div>`);

  const statusTxt = { valid: 'Valid', expiring: 'Due soon', expired: 'Expired', none: 'No date' }[c.status];
  return `
    <div class="card comp ${c.status}">
      <div class="top">
        <div style="flex:1;min-width:0">
          <div class="name">${esc(c.name)}</div>
          <div class="catline"><span class="cat">${catLabel(c.category)}</span></div>
        </div>
        <span class="status ${c.status}">${statusTxt}</span>
        <button class="iconbtn" onclick='openComp(${c.id})' title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>
      </div>
      ${dateBlocks.length ? `<div class="dates">${dateBlocks.join('')}</div>` : ''}
      ${(c.reference || c.responsible_person) ? `<div class="footer">
        <span class="ref">${c.reference ? esc(c.reference) : ''}${c.reference && c.responsible_person ? ' · ' : ''}${c.responsible_person ? esc(c.responsible_person) : ''}</span>
      </div>` : ''}
    </div>`;
}

async function loadComp() {
  const q = $('#compSearch').value.trim();
  const cat = $('#compFilter').value;
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (cat) qs.set('category', cat);
  const rows = await API('/compliance' + (qs.toString() ? '?' + qs : ''));
  const list = $('#compList');
  if (!rows.length) {
    list.innerHTML = emptyState('check', (q || cat) ? 'No matches' : 'Nothing tracked yet',
      (q || cat) ? 'Try a different filter.' : 'Add licences, services and renewals to track here.');
    return;
  }
  list.innerHTML = rows.map(compCard).join('');
}

function openComp(id) {
  const editing = id != null;
  const get = editing ? API('/compliance').then(r => r.find(x => x.id === id)) : Promise.resolve({ category: 'licence' });
  get.then(c => {
    c = c || {};
    const opts = Object.entries(CATS).map(([v, l]) =>
      `<option value="${v}" ${c.category === v ? 'selected' : ''}>${l}</option>`).join('');
    $('#modal').innerHTML = `
      <div class="mhead">
        <h3>${editing ? 'Edit item' : 'New tracked item'}</h3>
        <button class="iconbtn" onclick="closeModal()">✕</button>
      </div>
      <div class="mbody">
        <div class="field"><label>Name</label><input id="c_name" value="${esc(c.name)}" placeholder="e.g. Crane operator licence – J. Smith"></div>
        <div class="field"><label>Type</label><select id="c_category" onchange="compFieldToggle()">${opts}</select></div>
        <div id="expiryWrap" class="field"><label>Expiry date</label><input id="c_expiry_date" type="date" value="${esc(c.expiry_date)}"></div>
        <div id="serviceWrap" class="grid2" style="display:none">
          <div class="field"><label>Last service</label><input id="c_last_service_date" type="date" value="${esc(c.last_service_date)}"></div>
          <div class="field"><label>Next service due</label><input id="c_next_service_date" type="date" value="${esc(c.next_service_date)}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Reference / number</label><input id="c_reference" value="${esc(c.reference)}"></div>
          <div class="field"><label>Responsible person</label><input id="c_responsible_person" value="${esc(c.responsible_person)}"></div>
        </div>
        <div class="field"><label>Notes</label><textarea id="c_notes">${esc(c.notes)}</textarea></div>
      </div>
      <div class="mfoot">
        ${editing ? `<button class="btn danger" onclick="deleteComp(${id})">Delete</button>` : ''}
        <button class="btn" onclick="saveComp(${editing ? id : 'null'})">Save</button>
      </div>`;
    $('#modalBg').classList.add('show');
    compFieldToggle();
    setTimeout(() => $('#c_name').focus(), 60);
  });
}

function compFieldToggle() {
  const isMachine = $('#c_category').value === 'machine';
  $('#serviceWrap').style.display = isMachine ? 'grid' : 'none';
  $('#expiryWrap').style.display  = isMachine ? 'none' : 'block';
}

async function saveComp(id) {
  const isMachine = $('#c_category').value === 'machine';
  const body = {
    name: $('#c_name').value.trim(),
    category: $('#c_category').value,
    reference: $('#c_reference').value.trim(),
    responsible_person: $('#c_responsible_person').value.trim(),
    expiry_date: isMachine ? '' : $('#c_expiry_date').value,
    last_service_date: isMachine ? $('#c_last_service_date').value : '',
    next_service_date: isMachine ? $('#c_next_service_date').value : '',
    notes: $('#c_notes').value.trim(),
  };
  if (!body.name) { toast('Name is required', 'err'); return; }
  try {
    await API(id ? '/compliance/' + id : '/compliance',
      { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeModal(); toast(id ? 'Item updated' : 'Item added', 'ok');
    loadComp(); refreshBell();
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteComp(id) {
  if (!confirm('Delete this tracked item?')) return;
  try { await API('/compliance/' + id, { method: 'DELETE' }); closeModal(); toast('Deleted', 'ok'); loadComp(); refreshBell(); }
  catch (e) { toast(e.message, 'err'); }
}

/* ------------------------------------------------------------ settings ---- */
async function loadSettings() {
  settings = await API('/settings');
  $('#setBiz').value = settings.business_name || '';
  $('#setLead').value = settings.notify_lead_days || '60';
  $('#setTheme').checked = settings.theme === 'light';
  if (ME) {
    $('#meName').textContent = ME.username;
    $('#meRole').textContent = ME.role === 'admin' ? 'Administrator' : 'User';
  }
  gateAdminUI();
  if (ME && ME.role === 'admin') {
    loadUsers();
    try {
      const v = await API('/version');
      $('#verPill').textContent = 'v' + v.version;
      $('#repoLine').textContent = v.repo;
    } catch (e) {}
  }
}

async function saveSetting(key, value) {
  const payload = {};
  payload[key] = key === 'notify_lead_days' ? parseInt(value, 10) : value;
  try {
    settings = await API('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    applySettings(); toast('Saved', 'ok'); refreshBell();
  } catch (e) { toast(e.message, 'err'); }
}

function toggleTheme(light) {
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  document.querySelector('meta[name=theme-color]').setAttribute('content', light ? '#eef1f5' : '#15171c');
  saveSetting('theme', light ? 'light' : 'dark');
}

function applySettings() {
  $('#bizName').textContent = settings.business_name || '';
  document.documentElement.setAttribute('data-theme', settings.theme || 'dark');
}

/* ------------------------------------------------------------- update ----- */
let updateState = 'check';
async function doUpdate() {
  const btn = $('#updBtn');
  btn.disabled = true;
  if (updateState === 'check') {
    btn.textContent = 'Checking…';
    try {
      const r = await API('/update/check');
      if (r.error) { $('#updMsg').textContent = 'Could not reach GitHub: ' + r.error; btn.textContent = 'Check'; }
      else if (r.update_available) {
        $('#updTitle').textContent = `Update available — v${r.latest}`;
        $('#updMsg').textContent = `You're on v${r.current}. Tap to install.`;
        btn.textContent = 'Update now'; updateState = 'apply';
      } else {
        $('#updMsg').textContent = `You're on the latest version (v${r.current}).`;
        btn.textContent = 'Check';
      }
    } catch (e) { toast(e.message, 'err'); btn.textContent = 'Check'; }
  } else {
    btn.textContent = 'Updating…'; $('#updMsg').textContent = 'Downloading and applying…';
    try {
      const r = await API('/update', { method: 'POST' });
      if (r.ok) {
        $('#updMsg').textContent = r.message;
        btn.textContent = 'Restarting…';
        setTimeout(() => location.reload(), 6000);
        return;
      } else { $('#updMsg').textContent = r.message; btn.textContent = 'Update now'; }
    } catch (e) { toast(e.message, 'err'); btn.textContent = 'Update now'; }
  }
  btn.disabled = false;
}

/* ------------------------------------------------------------- bell ------- */
async function refreshBell() {
  try {
    const n = await API('/notifications');
    const c = $('#bellCount');
    c.textContent = n.count;
    c.classList.toggle('show', n.count > 0);
  } catch (e) {}
}

/* ------------------------------------------------------------ shared ------ */
function emptyState(icon, title, msg) {
  const icons = {
    box: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  };
  return `<div class="empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[icon] || icons.box}</svg>
    <p><strong>${title}</strong><br>${msg}</p>
  </div>`;
}

/* --------------------------------------------------------------- auth ----- */
function showLogin(msg = '') {
  $('#authBox').innerHTML = `
    <div class="brand"><b>Asset<span>IQ</span></b></div>
    <div class="auth-sub">Sign in to continue</div>
    <div class="field"><label>Username</label><input id="lg_user" autocomplete="username" placeholder="admin"></div>
    <div class="field"><label>Password</label><input id="lg_pass" type="password" autocomplete="current-password" placeholder="••••••"></div>
    <button class="btn" id="lg_btn" onclick="doLogin()">Sign in</button>
    <div class="auth-err" id="lg_err">${esc(msg)}</div>`;
  $('#authOverlay').classList.add('show');
  const pass = $('#lg_pass');
  const fire = e => { if (e.key === 'Enter') doLogin(); };
  $('#lg_user').addEventListener('keydown', fire);
  pass.addEventListener('keydown', fire);
  setTimeout(() => $('#lg_user').focus(), 60);
}

async function doLogin() {
  const username = $('#lg_user').value.trim();
  const password = $('#lg_pass').value;
  const btn = $('#lg_btn'); btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await API('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    setToken(r.token); ME = r.user;
    if (ME.must_change_password) showForcedChange();
    else enterApp();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Sign in';
    $('#lg_err').textContent = e.message;
  }
}

function showForcedChange() {
  $('#authBox').innerHTML = `
    <div class="brand"><b>Asset<span>IQ</span></b></div>
    <div class="auth-sub">Set a new password to continue</div>
    <div class="field"><label>Current password</label><input id="cp_cur" type="password" placeholder="••••••"></div>
    <div class="field"><label>New password</label><input id="cp_new" type="password" placeholder="At least 4 characters"></div>
    <div class="field"><label>Confirm new password</label><input id="cp_conf" type="password"></div>
    <button class="btn" id="cp_btn" onclick="doForcedChange()">Save and continue</button>
    <div class="auth-err" id="cp_err"></div>`;
  $('#authOverlay').classList.add('show');
  setTimeout(() => $('#cp_cur').focus(), 60);
}

async function doForcedChange() {
  const cur = $('#cp_cur').value, nw = $('#cp_new').value, conf = $('#cp_conf').value;
  const err = $('#cp_err');
  if (nw.length < 4) { err.textContent = 'New password must be at least 4 characters'; return; }
  if (nw !== conf) { err.textContent = 'Passwords don\'t match'; return; }
  const btn = $('#cp_btn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await API('/auth/change-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: cur, new_password: nw }),
    });
    ME.must_change_password = false;
    enterApp();
  } catch (e) { btn.disabled = false; btn.textContent = 'Save and continue'; err.textContent = e.message; }
}

async function logout() {
  try { await API('/auth/logout', { method: 'POST' }); } catch (e) {}
  clearToken(); ME = null;
  location.reload();
}

function openChangePw() {
  $('#modal').innerHTML = `
    <div class="mhead"><h3>Change password</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
    <div class="mbody">
      <div class="field"><label>Current password</label><input id="pw_cur" type="password"></div>
      <div class="field"><label>New password</label><input id="pw_new" type="password"></div>
      <div class="field"><label>Confirm new password</label><input id="pw_conf" type="password"></div>
    </div>
    <div class="mfoot"><button class="btn" onclick="doChangePw()">Update password</button></div>`;
  $('#modalBg').classList.add('show');
  setTimeout(() => $('#pw_cur').focus(), 60);
}

async function doChangePw() {
  const cur = $('#pw_cur').value, nw = $('#pw_new').value, conf = $('#pw_conf').value;
  if (nw.length < 4) { toast('New password must be 4+ characters', 'err'); return; }
  if (nw !== conf) { toast('Passwords don\'t match', 'err'); return; }
  try {
    await API('/auth/change-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: cur, new_password: nw }),
    });
    closeModal(); toast('Password updated', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

/* --------------------------------------------------------------- users ---- */
async function loadUsers() {
  if (!ME || ME.role !== 'admin') return;
  const users = await API('/users');
  $('#userList').innerHTML = users.map(u => `
    <div class="urow">
      <div class="uava">${esc((u.username[0] || '?').toUpperCase())}</div>
      <div class="uinfo">
        <div class="un">${esc(u.username)} ${u.id === ME.id ? '<span class="role-badge">you</span>' : ''}</div>
        <div class="ur">${u.role}${u.last_login ? ' · last in ' + esc(u.last_login.slice(0, 10)) : ' · never signed in'}</div>
      </div>
      <button class="iconbtn" onclick='openUser(${u.id})' title="Edit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
      </button>
    </div>`).join('');
}

function openUser(id) {
  const editing = id != null;
  const get = editing ? API('/users').then(r => r.find(x => x.id === id)) : Promise.resolve({ role: 'user' });
  get.then(u => {
    u = u || {};
    $('#modal').innerHTML = `
      <div class="mhead"><h3>${editing ? 'Edit user' : 'New user'}</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
      <div class="mbody">
        ${editing
          ? `<div class="field"><label>Username</label><input value="${esc(u.username)}" disabled></div>`
          : `<div class="field"><label>Username</label><input id="u_name" placeholder="e.g. jsmith"></div>`}
        <div class="field"><label>Role</label>
          <select id="u_role">
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </div>
        <div class="field"><label>${editing ? 'Reset password (optional)' : 'Initial password'}</label>
          <input id="u_pass" type="text" placeholder="${editing ? 'Leave blank to keep current' : 'They\'ll change it on first login'}"></div>
      </div>
      <div class="mfoot">
        ${editing && id !== ME.id ? `<button class="btn danger" onclick="deleteUser(${id})">Delete</button>` : ''}
        <button class="btn" onclick="saveUser(${editing ? id : 'null'})">Save</button>
      </div>`;
    $('#modalBg').classList.add('show');
  });
}

async function saveUser(id) {
  const role = $('#u_role').value;
  const pass = $('#u_pass').value;
  try {
    if (id) {
      await API('/users/' + id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, new_password: pass || null }),
      });
    } else {
      const name = $('#u_name').value.trim();
      if (!name) { toast('Username is required', 'err'); return; }
      if (pass.length < 4) { toast('Password must be 4+ characters', 'err'); return; }
      await API('/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password: pass, role }),
      });
    }
    closeModal(); toast(id ? 'User updated' : 'User added', 'ok'); loadUsers();
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteUser(id) {
  if (!confirm('Delete this user? They will lose access immediately.')) return;
  try { await API('/users/' + id, { method: 'DELETE' }); closeModal(); toast('User deleted', 'ok'); loadUsers(); }
  catch (e) { toast(e.message, 'err'); }
}

/* --------------------------------------------------------------- boot ----- */
function gateAdminUI() {
  const admin = ME && ME.role === 'admin';
  ['usersLabel', 'usersCard', 'softwareLabel', 'updateCard'].forEach(idv => {
    const el = document.getElementById(idv);
    if (el) el.style.display = admin ? '' : 'none';
  });
}

function enterApp() {
  $('#authOverlay').classList.remove('show');
  applySettings();
  gateAdminUI();
  refreshBell();
  loadDashboard();
}

(async function init() {
  if (!TOKEN) { showLogin(); return; }
  try {
    ME = await API('/auth/me');
    if (ME.must_change_password) { showForcedChange(); return; }
    settings = await API('/settings');
    enterApp();
  } catch (e) {
    // 401 already routes to login via API helper
    showLogin();
  }
})();
