/* ============================================================ AssetIQ ===== */
let TOKEN = localStorage.getItem('assetiq_token') || '';
let ME = null;

const API = (p, opt = {}) => {
  opt.headers = Object.assign({}, opt.headers, TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {});
  if (opt.cache === undefined) opt.cache = 'no-store';   // never serve stale GETs (e.g. version)
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
  certificate: 'Certificate', warranty: 'Warranty', checklist: 'Checklist', other: 'Other',
};
const catLabel = c => CATS[c] || 'Other';

/* ---- iconography -------------------------------------------------------- */
const _svg = (p, w = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

// Per-type icons for the Tracker (compliance) categories.
const CAT_ICONS = {
  licence:           '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M5 17c.5-2 2-3 4-3s3.5 1 4 3"/><line x1="15" y1="9" x2="19" y2="9"/><line x1="15" y1="13" x2="18" y2="13"/>',
  fire_extinguisher: '<path d="M9 8h4a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-8a3 3 0 0 1 1-2.2z"/><path d="M11 8V5a2 2 0 0 1 2-2h2"/><line x1="17" y1="4" x2="20" y2="4"/><line x1="9" y1="13" x2="14" y2="13"/>',
  software:          '<rect x="2" y="4" width="20" height="14" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><circle cx="5" cy="6.5" r=".6" fill="currentColor"/><path d="M8 21h8"/><path d="M12 18v3"/>',
  antivirus:         '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  vehicle:           '<path d="M5 11l1.5-4.2A2 2 0 0 1 8.4 5.5h7.2a2 2 0 0 1 1.9 1.3L19 11"/><path d="M5 11h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1"/><path d="M4 17h1"/><path d="M3 17v-4a1 1 0 0 1 1-1"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/>',
  machine:           '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  certificate:       '<circle cx="12" cy="9" r="5"/><path d="M9 13l-1.5 7L12 17l4.5 3L15 13"/><path d="M12 7v2l1.5 1"/>',
  warranty:          '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  checklist:         '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7l1.5 1.5L13 6"/><path d="M9 13l1.5 1.5L13 12"/><line x1="15" y1="7.5" x2="17" y2="7.5"/><line x1="15" y1="13.5" x2="17" y2="13.5"/>',
  other:             '<path d="M20.6 12.6 12 21l-8.5-8.5a3.3 3.3 0 0 1 0-4.7l3.3-3.3a3.3 3.3 0 0 1 4.7 0L20.6 13z"/><circle cx="8" cy="8" r="1"/>',
};
const catIcon = c => _svg(CAT_ICONS[c] || CAT_ICONS.other);

// Keyword-guessed icon for an Assets group (prefix folders like "Admin Office").
const GROUP_ICONS = [
  [/(office|admin|desk|reception|hq)/i, '<rect x="4" y="3" width="16" height="18" rx="1.5"/><line x1="9" y1="7" x2="9" y2="7"/><line x1="9" y1="11" x2="9" y2="11"/><line x1="13" y1="7" x2="13" y2="7"/><line x1="13" y1="11" x2="13" y2="11"/><path d="M10 21v-4h4v4"/>'],
  [/(vehicle|car|van|truck|fleet|bakkie)/i, '<path d="M5 11l1.5-4.2A2 2 0 0 1 8.4 5.5h7.2a2 2 0 0 1 1.9 1.3L19 11"/><path d="M4 11h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/>'],
  [/(tool|workshop|equip|machine|plant)/i, '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.3L3 18v3h3l6.4-6.4a4 4 0 0 0 5.3-5.4l-2.6 2.6-2.1-.5-.5-2.1z"/>'],
  [/(store|stock|storage|ware|inventory|spare)/i, '<path d="M21 8 12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="21"/>'],
  [/(it|network|computer|server|tech|pc|electronic)/i, '<rect x="4" y="4" width="16" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>'],
  [/(tv|av|audio|video|media|display|screen)/i, '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>'],
  [/(safety|fire|security|alarm)/i, '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>'],
];
const _GROUP_FALLBACK = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
function groupIcon(name) {
  const hit = GROUP_ICONS.find(([re]) => re.test(name || ''));
  return _svg(hit ? hit[1] : _GROUP_FALLBACK);
}
const CHEVRON = _svg('<polyline points="6 9 12 15 18 9"/>');

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
  if (tab === 'machines')   loadMachines();
  if (tab === 'checklists') loadChecklists();
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
let ASSET_GROUPS = [];

function assetCard(a) {
  const w = warrantyMeta(a.warranty_expiry);
  const label = a.label || (a.prefix || '') + String(a.asset_no).padStart(3, '0');
  return `
    <div class="card asset">
      ${a.has_photo
        ? `<div class="thumb" data-photo="${a.id}" onclick="viewPhoto(${a.id})"></div>`
        : `<div class="tag">${esc(label)}</div>`}
      <div class="meta">
        <div class="name">${a.has_photo ? `<span class="mono" style="color:var(--accent)">${esc(label)}</span> ` : ''}${esc(a.name)}</div>
        ${a.description ? `<div class="desc">${esc(a.description)}</div>` : ''}
        <div class="chips">
          ${a.category ? `<span class="chip">${esc(a.category)}</span>` : ''}
          ${a.location ? `<span class="chip">📍 ${esc(a.location)}</span>` : ''}
          ${a.assigned_to ? `<span class="chip">${esc(a.assigned_to)}</span>` : ''}
          ${a.serial_number ? `<span class="chip"><span class="mono">${esc(a.serial_number)}</span></span>` : ''}
          ${w ? `<span class="warranty-chip ${w.cls}">${w.label}</span>` : ''}
        </div>
      </div>
      <div class="rowactions">
        <button class="iconbtn" onclick='assetReport(${a.id})' title="Report">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
        </button>
        <button class="iconbtn" onclick='openAsset(${a.id})' title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>
      </div>
    </div>`;
}

async function loadAssets() {
  const q = $('#assetSearch').value.trim();
  const [rows, groups] = await Promise.all([
    API('/assets' + (q ? '?q=' + encodeURIComponent(q) : '')),
    ASSET_GROUPS.length ? Promise.resolve(ASSET_GROUPS) : API('/asset-groups'),
  ]);
  ASSET_GROUPS = groups;
  $('#assetCountSub').textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}`;
  const list = $('#assetList');
  if (!rows.length) {
    list.innerHTML = emptyState('box', q ? 'No matches' : 'No assets yet',
      q ? 'Try a different search.' : 'Add your first asset to start the register.');
    return;
  }
  // Group by prefix; show group sections in configured order, then any others.
  const order = groups.map(g => g.prefix);
  const byPrefix = {};
  rows.forEach(a => { (byPrefix[a.prefix] = byPrefix[a.prefix] || []).push(a); });
  const prefixes = [...new Set([...order, ...Object.keys(byPrefix)])].filter(p => byPrefix[p]);
  const nameFor = p => (groups.find(g => g.prefix === p) || {}).name || p;
  list.innerHTML = prefixes.map(p => `
    <details class="group">
      <summary>
        <span class="g-icon">${groupIcon(nameFor(p))}</span>
        <span class="g-name">${esc(nameFor(p))}</span>
        <span class="g-meta"><span class="g-tag">${esc(p)}</span><span class="g-count">${byPrefix[p].length}</span></span>
        <span class="g-chev">${CHEVRON}</span>
      </summary>
      <div class="group-body">${byPrefix[p].map(assetCard).join('')}</div>
    </details>`).join('');
  loadThumbs();
}

function warrantyMeta(expiry) {
  if (!expiry) return null;
  const days = Math.ceil((new Date(expiry) - new Date()) / 86400000);
  const lead = parseInt(settings.notify_lead_days || 60, 10);
  let cls = 'valid', label = `Warranty ${expiry}`;
  if (days < 0) { cls = 'expired'; label = 'Warranty expired'; }
  else if (days <= lead) { cls = 'expiring'; label = `Warranty ${days}d`; }
  return { cls, label };
}

// Lazy-load card thumbnails as authorised blobs (img tags can't send headers).
async function loadThumbs() {
  for (const el of document.querySelectorAll('.thumb[data-photo]')) {
    const id = el.getAttribute('data-photo');
    el.removeAttribute('data-photo');
    try {
      const r = await fetch(`/api/assets/${id}/photo`, { headers: { Authorization: 'Bearer ' + TOKEN } });
      if (r.ok) { const url = URL.createObjectURL(await r.blob()); el.style.backgroundImage = `url(${url})`; }
    } catch (e) {}
  }
}

async function viewPhoto(id) {
  try {
    const r = await fetch(`/api/assets/${id}/photo`, { headers: { Authorization: 'Bearer ' + TOKEN } });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    $('#lightboxImg').src = url;
    $('#lightbox').classList.add('show');
  } catch (e) {}
}

let _assetList = [];
function _numbersFor(prefix, selfNo) {
  const used = new Set(_assetList.filter(x => x.prefix === prefix).map(x => x.asset_no).filter(n => n != null));
  if (selfNo != null) used.delete(selfNo);
  let next = 1; while (used.has(next)) next++;
  const freed = [];
  for (let n = 1; n < next; n++) if (!used.has(n)) freed.push(n);
  return { next, freed };
}

function openAsset(id) {
  const editing = id != null;
  Promise.all([
    API('/assets'),
    ASSET_GROUPS.length ? Promise.resolve(ASSET_GROUPS) : API('/asset-groups'),
  ]).then(([list, groups]) => {
    _assetList = list; ASSET_GROUPS = groups;
    const a = editing ? (list.find(x => x.id === id) || {}) : {};
    const prefix = editing ? a.prefix : ((groups[0] || {}).prefix || 'OF');
    const { next, freed } = _numbersFor(prefix, editing ? a.asset_no : null);
    const suggested = editing ? (a.asset_no ?? next) : next;
    const groupOpts = groups.map(g =>
      `<option value="${esc(g.prefix)}" ${g.prefix === prefix ? 'selected' : ''}>${esc(g.name)} (${esc(g.prefix)})</option>`).join('');

    $('#modal').innerHTML = `
      <div class="mhead">
        <h3>${editing ? 'Edit asset' : 'New asset'}</h3>
        <button class="iconbtn" onclick="closeModal()">✕</button>
      </div>
      <div class="mbody">
        <div class="grid2">
          <div class="field"><label>Group <button type="button" class="link-mini" onclick="openGroups()">manage</button></label>
            <select id="f_prefix" onchange="onGroupChange()">${groupOpts}</select>
          </div>
          <div class="field"><label>Label number</label>
            <input id="f_asset_no" type="number" min="1" value="${suggested}" oninput="updateLabelPreview()">
          </div>
        </div>
        <div class="label-preview">Label: <b id="labelPreview">${esc(prefix)}${String(suggested).padStart(3, '0')}</b></div>
        <div class="numhint" id="numHint"></div>
        <div class="numchips" id="numChips"></div>

        <div class="field" style="margin-top:14px"><label>Name</label><input id="f_name" value="${esc(a.name)}" placeholder="e.g. Office chair – Roxanne"></div>
        <div class="field"><label>Category</label><input id="f_category" value="${esc(a.category)}" placeholder="Furniture / Tool…"></div>
        <div class="field"><label>Description</label><input id="f_description" value="${esc(a.description)}"></div>
        <div class="grid2">
          <div class="field"><label>Location</label><input id="f_location" value="${esc(a.location)}"></div>
          <div class="field"><label>Assigned to</label><input id="f_assigned_to" value="${esc(a.assigned_to)}"></div>
        </div>
        <div class="field"><label>Serial number</label><input id="f_serial_number" value="${esc(a.serial_number)}"></div>

        <div class="field"><label>Photo</label>
          <div class="photo-pick">
            <div class="preview ${a.has_photo ? '' : 'empty'}" id="photoPreview">${a.has_photo ? '' : 'No photo'}</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <button type="button" class="btn ghost small" onclick="document.getElementById('photoInputCamera').click()">Take photo</button>
              <button type="button" class="btn ghost small" onclick="document.getElementById('photoInputFile').click()">${a.has_photo ? 'Replace' : 'Upload photo'}</button>
              <button type="button" class="btn ghost small" id="photoRemoveBtn" onclick="removePhoto()" style="${a.has_photo ? '' : 'display:none'}">Remove</button>
            </div>
            <input type="file" id="photoInputCamera" accept="image/*" capture="environment" style="display:none" onchange="pickPhoto(this)">
            <input type="file" id="photoInputFile" accept="image/*" style="display:none" onchange="pickPhoto(this)">
          </div>
        </div>

        <div class="section-label" style="margin:14px 0 10px;font-size:12px">Purchase &amp; warranty</div>
        <div class="grid2">
          <div class="field"><label>Purchase date</label><input id="f_purchase_date" type="date" value="${esc(a.purchase_date)}"></div>
          <div class="field"><label>Cost</label><input id="f_cost" inputmode="decimal" value="${esc(a.cost)}" placeholder="R"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Supplier</label><input id="f_supplier" value="${esc(a.supplier)}"></div>
          <div class="field"><label>Warranty expiry</label><input id="f_warranty_expiry" type="date" value="${esc(a.warranty_expiry)}"></div>
        </div>

        <div class="field"><label>Notes</label><textarea id="f_notes">${esc(a.notes)}</textarea></div>
      </div>
      <div class="mfoot">
        ${editing ? `<button class="btn danger" onclick="deleteAsset(${id})">Delete</button>` : ''}
        <button class="btn" onclick="saveAsset(${editing ? id : 'null'})">Save</button>
      </div>`;
    assetPhoto = undefined;
    _editingAssetNo = editing ? a.asset_no : null;
    renderNumChips(prefix, suggested);
    $('#modalBg').classList.add('show');
    if (a.has_photo) loadPreviewThumb(id);
    setTimeout(() => $('#f_name').focus(), 60);
  });
}

let _editingAssetNo = null;
function renderNumChips(prefix, current) {
  const { next, freed } = _numbersFor(prefix, _editingAssetNo);
  const picks = [...new Set([...freed, next, current])].filter(n => n > 0).sort((x, y) => x - y).slice(0, 14);
  $('#numHint').textContent = freed.length
    ? 'Tap a freed number to reuse it, or type your own.'
    : 'Next free number in this group. Change it if you want.';
  $('#numChips').innerHTML = picks.map(n =>
    `<button type="button" class="numchip${n === current ? ' on' : ''}${freed.includes(n) ? ' free' : ''}" onclick="setAssetNo(${n})">${String(n).padStart(3, '0')}</button>`).join('');
}

function onGroupChange() {
  const prefix = $('#f_prefix').value;
  const { next } = _numbersFor(prefix, _editingAssetNo);
  $('#f_asset_no').value = next;
  renderNumChips(prefix, next);
  updateLabelPreview();
}

function updateLabelPreview() {
  const prefix = $('#f_prefix').value;
  const no = parseInt($('#f_asset_no').value, 10) || 0;
  $('#labelPreview').textContent = prefix + String(no).padStart(3, '0');
  document.querySelectorAll('#numChips .numchip').forEach(c =>
    c.classList.toggle('on', parseInt(c.textContent, 10) === no));
}

let assetPhoto;   // undefined = unchanged, '' = remove, dataURL = new image

async function loadPreviewThumb(id) {
  try {
    const r = await fetch(`/api/assets/${id}/photo`, { headers: { Authorization: 'Bearer ' + TOKEN } });
    if (r.ok) $('#photoPreview').style.backgroundImage = `url(${URL.createObjectURL(await r.blob())})`;
  } catch (e) {}
}

function pickPhoto(input) {
  const file = input.files[0]; input.value = '';
  if (!file) return;
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => { img.onload = () => {
    // Downscale to max 1024px, export JPEG ~0.72 so the DB stays small.
    const max = 1024;
    let { width: w, height: h } = img;
    if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    assetPhoto = c.toDataURL('image/jpeg', 0.72);
    const p = $('#photoPreview');
    p.classList.remove('empty'); p.textContent = ''; p.style.backgroundImage = `url(${assetPhoto})`;
    $('#photoRemoveBtn').style.display = '';
  }; img.src = reader.result; };
  reader.readAsDataURL(file);
}

function removePhoto() {
  assetPhoto = '';
  const p = $('#photoPreview');
  p.classList.add('empty'); p.textContent = 'No photo'; p.style.backgroundImage = '';
  $('#photoRemoveBtn').style.display = 'none';
}

function setAssetNo(n) {
  $('#f_asset_no').value = n;
  updateLabelPreview();
}

async function saveAsset(id) {
  const body = {};
  ['name', 'description', 'category', 'location', 'serial_number', 'assigned_to', 'notes',
   'purchase_date', 'cost', 'supplier', 'warranty_expiry']
    .forEach(k => body[k] = $('#f_' + k).value.trim());
  const noVal = $('#f_asset_no').value.trim();
  body.asset_no = noVal ? parseInt(noVal, 10) : null;
  body.prefix = $('#f_prefix').value;
  if (assetPhoto !== undefined) body.photo = assetPhoto;   // '' removes, dataURL sets
  if (!body.name) { toast('Name is required', 'err'); return; }
  try {
    await API(id ? '/assets/' + id : '/assets',
      { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeModal(); toast(id ? 'Asset updated' : 'Asset added', 'ok'); loadAssets();
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteAsset(id) {
  if (!confirm('Delete this asset? Its label number frees up and can be reused.')) return;
  try { await API('/assets/' + id, { method: 'DELETE' }); closeModal(); toast('Asset deleted', 'ok'); loadAssets(); }
  catch (e) { toast(e.message, 'err'); }
}

/* ------------------------------------------------------- asset groups ----- */
async function openGroups() {
  let groups, assets;
  try {
    [groups, assets] = await Promise.all([API('/asset-groups'), API('/assets')]);
  } catch (e) { toast(e.message, 'err'); return; }
  ASSET_GROUPS = groups;
  const count = {};
  assets.forEach(a => { count[a.prefix] = (count[a.prefix] || 0) + 1; });
  const rows = groups.map(g => `
    <div class="grp-row">
      <span class="g-icon">${groupIcon(g.name)}</span>
      <div class="grp-main">
        <div class="grp-name">${esc(g.name)}</div>
        <div class="grp-sub"><span class="g-tag">${esc(g.prefix)}</span> · ${count[g.prefix] || 0} asset${(count[g.prefix] || 0) === 1 ? '' : 's'}</div>
      </div>
      <button class="iconbtn" onclick='openGroupForm(${g.id})' title="Edit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
      </button>
      <button class="iconbtn danger" onclick='deleteGroup(${g.id}, ${JSON.stringify(g.prefix)}, ${count[g.prefix] || 0})' title="Delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>`).join('');
  $('#modal').innerHTML = `
    <div class="mhead"><h3>Asset groups</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
    <div class="mbody">
      <p style="color:var(--muted);font-size:13px;margin:0 0 10px">Groups sort your register and set the label prefix (e.g. WM-001 for Workshop Machines).</p>
      <div class="grp-list">${rows || '<p style="color:var(--muted)">No groups yet.</p>'}</div>
      <button class="btn small" style="margin-top:10px" onclick="openGroupForm()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New group
      </button>
    </div>`;
  $('#modalBg').classList.add('show');
}

function openGroupForm(id) {
  const editing = !!id;
  const g = editing ? (ASSET_GROUPS.find(x => x.id === id) || {}) : { name: '', prefix: '' };
  $('#modal').innerHTML = `
    <div class="mhead"><h3>${editing ? 'Edit group' : 'New group'}</h3><button class="iconbtn" onclick="openGroups()">✕</button></div>
    <div class="mbody">
      <div class="field"><label>Name</label><input id="g_name" value="${esc(g.name)}" placeholder="Workshop Machines"></div>
      <div class="field"><label>Label prefix</label>
        <input id="g_prefix" value="${esc(g.prefix)}" maxlength="6" placeholder="WM"
               oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')">
      </div>
      <div class="numhint">Letters and numbers only. Labels become like <span class="mono">WM001</span>, <span class="mono">WM002</span>…</div>
    </div>
    <div class="mfoot"><button class="btn" onclick="saveGroup(${id || 0})">${editing ? 'Save' : 'Add group'}</button></div>`;
  $('#modalBg').classList.add('show');
  setTimeout(() => $('#g_name').focus(), 60);
}

async function saveGroup(id) {
  const name = $('#g_name').value.trim();
  const prefix = $('#g_prefix').value.trim().toUpperCase();
  if (!name || !prefix) { toast('Name and prefix are required', 'err'); return; }
  try {
    await API(id ? '/asset-groups/' + id : '/asset-groups',
      { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, prefix }) });
    ASSET_GROUPS = [];                       // bust cache so dropdowns refresh
    toast(id ? 'Group updated' : 'Group added', 'ok');
    await openGroups();                      // reopen manager with fresh data
    if ($('#view-assets').classList.contains('active')) loadAssets();
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteGroup(id, prefix, inUse) {
  if (inUse) { toast(`${inUse} asset${inUse === 1 ? '' : 's'} still use ${prefix} — move them first`, 'err'); return; }
  if (!confirm(`Delete the ${prefix} group?`)) return;
  try {
    await API('/asset-groups/' + id, { method: 'DELETE' });
    ASSET_GROUPS = [];
    toast('Group deleted', 'ok');
    await openGroups();
    if ($('#view-assets').classList.contains('active')) loadAssets();
  } catch (e) { toast(e.message, 'err'); }
}

async function printLabels() {
  let rows;
  try { rows = await API('/assets'); } catch (e) { toast(e.message, 'err'); return; }
  if (!rows.length) { toast('No assets to print', 'err'); return; }
  toast('Building labels…');
  // Fetch each QR (authorised) and inline the SVG.
  const qrs = await Promise.all(rows.map(a =>
    fetch(`/api/assets/${a.id}/qr.svg`, { headers: { Authorization: 'Bearer ' + TOKEN } })
      .then(r => r.ok ? r.text() : '').catch(() => '')));
  $('#labelSheet').innerHTML = rows.map((a, i) =>
    `<div class="label">
       <div class="qr">${qrs[i]}</div>
       <div class="lbl-text"><div class="no">${String(a.asset_no).padStart(3, '0')}</div><div class="nm">${esc(a.name)}</div></div>
     </div>`).join('');
  setTimeout(() => window.print(), 150);
}

/* -------------------------------------------------------- compliance ------ */
function compCard(c) {
  const isMachine = c.category === 'machine';
  const isReal = Number.isInteger(c.id);   // false for warranty/checklist dashboard alerts
  const dateBlocks = [];
  if (c.expiry_date) dateBlocks.push(
    `<div><div class="k">Expires</div><div class="v">${esc(c.expiry_date)}</div>${daysBadge({ days_remaining: c.days_until_expiry, status: c.status })}</div>`);
  if (c.last_service_date) dateBlocks.push(
    `<div><div class="k">Last service</div><div class="v">${esc(c.last_service_date)}</div></div>`);
  if (c.next_service_date) dateBlocks.push(
    `<div><div class="k">Next service</div><div class="v">${esc(c.next_service_date)}</div>${daysBadge({ days_remaining: c.days_until_service, status: c.status })}</div>`);

  const statusTxt = { valid: 'Valid', expiring: 'Due soon', expired: 'Expired', none: 'No date' }[c.status];
  const canRenew = isReal && c.category !== 'warranty' && c.category !== 'checklist';
  const renewLabel = isMachine ? 'Log service' : 'Renew';
  // A still-valid licence (further out than the warning window) can't be renewed yet.
  // Machines can always log a service; undated items stay open so a first date can be set.
  const renewLocked = canRenew && !isMachine && c.status === 'valid' && !!c.expiry_date;
  const unlockOn = renewLocked ? renewUnlockDate(c) : null;

  const renewBtn = renewLocked
    ? `<button class="btn small" disabled title="Renew opens ${unlockOn} — ${leadLabel()} before expiry">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
         ${renewLabel}
       </button>`
    : `<button class="btn small" onclick='openRenew(${c.id}, ${isMachine})'>${renewLabel}</button>`;

  return `
    <div class="card comp ${c.status}">
      <div class="top">
        ${c.has_photo ? `<div class="thumb" data-cphoto="${c.id}" onclick="viewCompPhoto(${c.id})"></div>` : ''}
        <div style="flex:1;min-width:0">
          <div class="name">${esc(c.name)}</div>
          <div class="catline"><span class="cat-ico cat-${c.category}">${catIcon(c.category)}</span><span class="cat">${catLabel(c.category)}</span></div>
        </div>
        <span class="status ${c.status}">${statusTxt}</span>
        ${isReal ? `<button class="iconbtn" onclick='openComp(${c.id})' title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>` : ''}
      </div>
      ${dateBlocks.length ? `<div class="dates">${dateBlocks.join('')}</div>` : ''}
      ${c.responsible_person ? `<div class="resp"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span>Responsible: <b>${esc(c.responsible_person)}</b></span></div>` : ''}
      ${c.reference ? `<div class="ref-line">${esc(c.reference)}</div>` : ''}
      ${canRenew ? `<div class="comp-actions">
        ${renewBtn}
        <button class="btn ghost small" onclick='openHistory(${c.id})'>History</button>
        <button class="btn ghost small" onclick='compReport(${c.id})'>Report</button>
      </div>
      ${renewLocked ? `<div class="renew-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Still valid — renew opens ${unlockOn}</div>` : ''}` : ''}
    </div>`;
}

// Date the renew button becomes available: the warning window before expiry.
function renewUnlockDate(c) {
  if (!c.expiry_date) return null;
  const lead = parseInt(settings.notify_lead_days || 60, 10);
  const d = new Date(c.expiry_date);
  d.setDate(d.getDate() - lead);
  return d.toISOString().slice(0, 10);
}
function leadLabel() {
  const lead = parseInt(settings.notify_lead_days || 60, 10);
  const m = Math.round(lead / 30);
  return m <= 1 ? '1 month' : `${m} months`;
}

function openRenew(id, isMachine) {
  const title = isMachine ? 'Log service' : 'Renew';
  $('#modal').innerHTML = `
    <div class="mhead"><h3>${title}</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
    <div class="mbody">
      ${isMachine
        ? `<div class="field"><label>Service date</label><input id="rn_service" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
           <div class="field"><label>Next service due</label><input id="rn_due" type="date"></div>`
        : `<div class="field"><label>New expiry date</label><input id="rn_due" type="date"></div>
           <div class="field"><label>Date issued <span style="text-transform:none;color:var(--muted)">(optional)</span></label><input id="rn_issue" type="date"></div>`}
      <div class="field"><label>Note <span style="text-transform:none;color:var(--muted)">(optional)</span></label><input id="rn_note" placeholder="e.g. renewed at licensing dept"></div>
      <div class="numhint">The current dates are saved to history before the new ones take over.</div>
    </div>
    <div class="mfoot"><button class="btn" onclick="submitRenew(${id}, ${isMachine})">Save renewal</button></div>`;
  $('#modalBg').classList.add('show');
  setTimeout(() => $('#rn_due').focus(), 60);
}

async function submitRenew(id, isMachine) {
  const due = $('#rn_due').value;
  if (!due) { toast(isMachine ? 'Next service date is required' : 'New expiry date is required', 'err'); return; }
  const body = { new_due: due, note: $('#rn_note').value.trim() };
  if (isMachine) body.service_date = $('#rn_service').value;
  else body.issue_date = ($('#rn_issue') || {}).value || '';
  try {
    await API('/compliance/' + id + '/renew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeModal(); toast('Renewed — back up to date', 'ok');
    loadComp(); refreshBell();
    if ($('#view-dashboard').classList.contains('active')) loadDashboard();
  } catch (e) { toast(e.message, 'err'); }
}

async function openHistory(id) {
  let hist;
  try { hist = await API('/compliance/' + id + '/history'); } catch (e) { toast(e.message, 'err'); return; }
  $('#modal').innerHTML = `
    <div class="mhead"><h3>Renewal history</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
    <div class="mbody">
      ${!hist.length ? '<p style="color:var(--muted)">No renewals recorded yet.</p>' :
        hist.map(h => `
          <div class="hist-row">
            <div class="hist-line"><span class="old">${esc(h.prev_due || '—')}</span> <span class="arr">→</span> <b>${esc(h.new_due)}</b></div>
            <div class="hist-meta">${esc(h.renewed_at.replace('T', ' ').slice(0, 16))}${h.renewed_by ? ' · ' + esc(h.renewed_by) : ''}${h.new_issue ? ' · issued ' + esc(h.new_issue) : ''}</div>
            ${h.note ? `<div class="hist-note">${esc(h.note)}</div>` : ''}
          </div>`).join('')}
    </div>`;
  $('#modalBg').classList.add('show');
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
  // Collapsible sections per category, in the order they appear in the type list.
  const order = Object.keys(CATS);
  const byCat = {};
  rows.forEach(c => { (byCat[c.category] = byCat[c.category] || []).push(c); });
  const cats = [...new Set([...order, ...Object.keys(byCat)])].filter(c => byCat[c]);
  list.innerHTML = cats.map(c => {
    const items = byCat[c];
    const bad = items.filter(i => i.status === 'expired' || i.status === 'expiring').length;
    return `
      <details class="group">
        <summary>
          <span class="g-icon cat-${c}">${catIcon(c)}</span>
          <span class="g-name">${catLabel(c)}</span>
          <span class="g-meta">${bad ? `<span class="g-flag">${bad}</span>` : ''}<span class="g-count">${items.length}</span></span>
          <span class="g-chev">${CHEVRON}</span>
        </summary>
        <div class="group-body">${items.map(compCard).join('')}</div>
      </details>`;
  }).join('');
  loadCompThumbs();
}

// Lazy-load compliance card thumbnails as authorised blobs (img tags can't send headers).
async function loadCompThumbs() {
  for (const el of document.querySelectorAll('.thumb[data-cphoto]')) {
    const id = el.getAttribute('data-cphoto');
    el.removeAttribute('data-cphoto');
    try {
      const r = await fetch(`/api/compliance/${id}/photo`, { headers: { Authorization: 'Bearer ' + TOKEN } });
      if (r.ok) { const url = URL.createObjectURL(await r.blob()); el.style.backgroundImage = `url(${url})`; }
    } catch (e) {}
  }
}

async function viewCompPhoto(id) {
  try {
    const r = await fetch(`/api/compliance/${id}/photo`, { headers: { Authorization: 'Bearer ' + TOKEN } });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    $('#lightboxImg').src = url;
    $('#lightbox').classList.add('show');
  } catch (e) {}
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
        <div id="expiryWrap"><div class="grid2">
          <div class="field"><label>Date issued</label><input id="c_issue_date" type="date" value="${esc(c.issue_date)}"></div>
          <div class="field"><label>Expiry date</label><input id="c_expiry_date" type="date" value="${esc(c.expiry_date)}"></div>
        </div></div>
        <div id="serviceWrap" class="grid2" style="display:none">
          <div class="field"><label>Last service</label><input id="c_last_service_date" type="date" value="${esc(c.last_service_date)}"></div>
          <div class="field"><label>Next service due</label><input id="c_next_service_date" type="date" value="${esc(c.next_service_date)}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Reference / number</label><input id="c_reference" value="${esc(c.reference)}"></div>
          <div class="field"><label>Responsible person</label><input id="c_responsible_person" value="${esc(c.responsible_person)}"></div>
        </div>
        <div class="field"><label>Photo</label>
          <div class="photo-pick">
            <div class="preview ${c.has_photo ? '' : 'empty'}" id="c_photoPreview">${c.has_photo ? '' : 'No photo'}</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <button type="button" class="btn ghost small" onclick="document.getElementById('c_photoInputCamera').click()">Take photo</button>
              <button type="button" class="btn ghost small" onclick="document.getElementById('c_photoInputFile').click()">${c.has_photo ? 'Replace' : 'Upload photo'}</button>
              <button type="button" class="btn ghost small" id="c_photoRemoveBtn" onclick="removeCompPhoto()" style="${c.has_photo ? '' : 'display:none'}">Remove</button>
            </div>
            <input type="file" id="c_photoInputCamera" accept="image/*" capture="environment" style="display:none" onchange="pickCompPhoto(this)">
            <input type="file" id="c_photoInputFile" accept="image/*" style="display:none" onchange="pickCompPhoto(this)">
          </div>
        </div>
        <div class="field"><label>Notes</label><textarea id="c_notes">${esc(c.notes)}</textarea></div>
      </div>
      <div class="mfoot">
        ${editing ? `<button class="btn danger" onclick="deleteComp(${id})">Delete</button>` : ''}
        <button class="btn" onclick="saveComp(${editing ? id : 'null'})">Save</button>
      </div>`;
    compPhoto = undefined;
    $('#modalBg').classList.add('show');
    compFieldToggle();
    if (c.has_photo) loadPreviewCompThumb(id);
    setTimeout(() => $('#c_name').focus(), 60);
  });
}

let compPhoto;   // undefined = unchanged, '' = remove, dataURL = new image

async function loadPreviewCompThumb(id) {
  try {
    const r = await fetch(`/api/compliance/${id}/photo`, { headers: { Authorization: 'Bearer ' + TOKEN } });
    if (r.ok) $('#c_photoPreview').style.backgroundImage = `url(${URL.createObjectURL(await r.blob())})`;
  } catch (e) {}
}

function pickCompPhoto(input) {
  const file = input.files[0]; input.value = '';
  if (!file) return;
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => { img.onload = () => {
    // Downscale to max 1024px, export JPEG ~0.72 so the DB stays small.
    const max = 1024;
    let { width: w, height: h } = img;
    if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    compPhoto = c.toDataURL('image/jpeg', 0.72);
    const p = $('#c_photoPreview');
    p.classList.remove('empty'); p.textContent = ''; p.style.backgroundImage = `url(${compPhoto})`;
    $('#c_photoRemoveBtn').style.display = '';
  }; img.src = reader.result; };
  reader.readAsDataURL(file);
}

function removeCompPhoto() {
  compPhoto = '';
  const p = $('#c_photoPreview');
  p.classList.add('empty'); p.textContent = 'No photo'; p.style.backgroundImage = '';
  $('#c_photoRemoveBtn').style.display = 'none';
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
    issue_date: isMachine ? '' : ($('#c_issue_date') || {}).value || '',
    expiry_date: isMachine ? '' : $('#c_expiry_date').value,
    last_service_date: isMachine ? $('#c_last_service_date').value : '',
    next_service_date: isMachine ? $('#c_next_service_date').value : '',
    notes: $('#c_notes').value.trim(),
  };
  if (compPhoto !== undefined) body.photo = compPhoto;   // '' removes, dataURL sets
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

/* ----------------------------------------------------- machine services --- */
const MKINDS = { truck: 'Truck', compressor: 'Compressor', pc: 'PC', machine: 'Machine' };
const mkindLabel = k => MKINDS[k] || 'Machine';
// Reuse existing category colours so no extra CSS is needed.
const MKIND_COLORCLASS = { truck: 'vehicle', compressor: 'machine', pc: 'software', machine: 'machine' };
const MKIND_ICONS = {
  truck:      '<path d="M5 11l1.5-4.2A2 2 0 0 1 8.4 5.5h7.2a2 2 0 0 1 1.9 1.3L19 11"/><path d="M5 11h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1"/><path d="M3 17v-4a1 1 0 0 1 1-1"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/>',
  compressor: '<rect x="3" y="9" width="12" height="9" rx="1.5"/><circle cx="9" cy="13.5" r="2.4"/><path d="M15 11h3a2 2 0 0 1 2 2v5"/><path d="M7 9V7a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/>',
  pc:         '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  machine:    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
};
const mkindIcon = k => _svg(MKIND_ICONS[k] || MKIND_ICONS.machine);

// yyyy-mm-dd + N months, clamping the day to the month's length.
function addMonths(iso, months) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return '';
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

const MUNIT = { km: 'km', hours: 'hrs' };
const fmtNum = n => (n === null || n === undefined || n === '') ? '' :
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const modeCadence = m => {
  if (m.track_by === 'km')    return `every ${fmtNum(m.interval_km || 0)} km`;
  if (m.track_by === 'hours') return `every ${fmtNum(m.interval_hours || 0)} hrs`;
  return `every ${m.interval_months || 6} months`;
};

function machineCard(m) {
  const cc = MKIND_COLORCLASS[m.kind] || 'machine';
  const statusTxt = { valid: 'On schedule', expiring: 'Due soon', expired: 'Overdue', none: 'No schedule' }[m.status] || '';
  const usage = m.track_by === 'km' || m.track_by === 'hours';
  const unit = MUNIT[m.track_by] || '';
  const blocks = [];
  if (usage) {
    blocks.push(`<div><div class="k">Current</div><div class="v">${fmtNum(m.current_reading || 0)} ${unit}</div></div>`);
    if (m.next_service_reading) blocks.push(
      `<div><div class="k">Service at</div><div class="v">${fmtNum(m.next_service_reading)} ${unit}</div>${m.remaining_label ? `<span class="when ${m.status}">${esc(m.remaining_label)}</span>` : ''}</div>`);
  } else {
    if (m.last_service_date) blocks.push(
      `<div><div class="k">Last service</div><div class="v">${esc(m.last_service_date)}</div></div>`);
    if (m.next_service_date) blocks.push(
      `<div><div class="k">Next service</div><div class="v">${esc(m.next_service_date)}</div>${daysBadge({ days_remaining: m.days_until_service, status: m.status })}</div>`);
  }
  const metaChips = [];
  if (m.location) metaChips.push(`<span class="ref-line">📍 ${esc(m.location)}</span>`);
  if (m.serial_number) metaChips.push(`<span class="ref-line">${esc(m.serial_number)}</span>`);

  return `
    <div class="card comp ${m.status}">
      <div class="top">
        <div style="flex:1;min-width:0">
          <div class="name">${esc(m.name)}</div>
          <div class="catline"><span class="cat-ico cat-${cc}">${mkindIcon(m.kind)}</span><span class="cat">${mkindLabel(m.kind)} · ${modeCadence(m)}</span></div>
        </div>
        <span class="status ${m.status}">${statusTxt}</span>
        <button class="iconbtn" onclick='openMachine(${m.id})' title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>
      </div>
      ${blocks.length ? `<div class="dates">${blocks.join('')}</div>` : ''}
      ${metaChips.length ? `<div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap">${metaChips.join('')}</div>` : ''}
      <div class="comp-actions">
        <button class="btn small" onclick='openLogService(${m.id})'>Log service</button>
        ${usage ? `<button class="btn ghost small" onclick='openReading(${m.id})'>Update ${unit}</button>` : ''}
        <button class="btn ghost small" onclick='openMachineHistory(${m.id})'>History</button>
      </div>
    </div>`;
}

async function loadMachines() {
  const q = $('#machineSearch').value.trim();
  const kind = $('#machineFilter').value;
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (kind) qs.set('kind', kind);
  const rows = await API('/machines' + (qs.toString() ? '?' + qs : ''));
  $('#machineCountSub').textContent = `${rows.length} machine${rows.length === 1 ? '' : 's'}`;
  const list = $('#machineList');
  if (!rows.length) {
    list.innerHTML = emptyState('box', (q || kind) ? 'No matches' : 'No machines yet',
      (q || kind) ? 'Try a different search.' : 'Import your machine assets, or add one to start tracking its service schedule.');
    return;
  }
  const order = Object.keys(MKINDS);
  const byKind = {};
  rows.forEach(m => { (byKind[m.kind] = byKind[m.kind] || []).push(m); });
  const kinds = [...new Set([...order, ...Object.keys(byKind)])].filter(k => byKind[k]);
  list.innerHTML = kinds.map(k => {
    const items = byKind[k];
    const bad = items.filter(i => i.status === 'expired' || i.status === 'expiring').length;
    const cc = MKIND_COLORCLASS[k] || 'machine';
    return `
      <details class="group" open>
        <summary>
          <span class="g-icon cat-${cc}">${mkindIcon(k)}</span>
          <span class="g-name">${mkindLabel(k)}</span>
          <span class="g-meta">${bad ? `<span class="g-flag">${bad}</span>` : ''}<span class="g-count">${items.length}</span></span>
          <span class="g-chev">${CHEVRON}</span>
        </summary>
        <div class="group-body">${items.map(machineCard).join('')}</div>
      </details>`;
  }).join('');
}

/* ---- import machine-group assets from the register ---- */
function openImport() {
  API('/machines/importable').then(rows => {
    if (!rows.length) { toast('No untracked machine assets found', 'err'); return; }
    $('#modal').innerHTML = `
      <div class="mhead"><h3>Import from assets</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
      <div class="mbody">
        <div class="numhint">Machine-group assets from your register that aren’t tracked yet. Tick the ones to add — each starts on a 6-month schedule you can switch to km or hours.</div>
        ${rows.map(a => `
          <label style="display:flex;align-items:center;gap:10px;padding:9px 2px;border-bottom:1px solid var(--line)">
            <input type="checkbox" class="imp-cb" value="${a.id}" checked>
            <span class="mono" style="color:var(--accent)">${esc(a.label || '')}</span>
            <span style="flex:1">${esc(a.name)}</span>
          </label>`).join('')}
      </div>
      <div class="mfoot"><button class="btn" onclick="importMachines()">Import selected</button></div>`;
    $('#modalBg').classList.add('show');
  }).catch(e => toast(e.message, 'err'));
}

async function importMachines() {
  const ids = [...document.querySelectorAll('.imp-cb:checked')].map(c => parseInt(c.value, 10));
  if (!ids.length) { toast('Select at least one machine', 'err'); return; }
  try {
    const r = await API('/machines/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset_ids: ids }) });
    closeModal(); toast(`Imported ${r.added} machine${r.added === 1 ? '' : 's'}`, 'ok');
    loadMachines(); refreshBell();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---- add / edit ---- */
function openMachine(id) {
  const editing = id != null;
  const get = editing ? API('/machines').then(r => r.find(x => x.id === id))
                      : Promise.resolve({ kind: 'machine', track_by: 'months', interval_months: 6 });
  get.then(m => {
    m = m || {};
    const kindOpts = Object.entries(MKINDS).map(([v, l]) =>
      `<option value="${v}" ${m.kind === v ? 'selected' : ''}>${l}</option>`).join('');
    const modeOpts = [['months', 'Time — months'], ['km', 'Distance — km'], ['hours', 'Run time — hours']]
      .map(([v, l]) => `<option value="${v}" ${(m.track_by || 'months') === v ? 'selected' : ''}>${l}</option>`).join('');
    const uIntervalVal = m.track_by === 'hours' ? (m.interval_hours || 0) : (m.interval_km || 0);
    $('#modal').innerHTML = `
      <div class="mhead">
        <h3>${editing ? 'Edit machine' : 'New machine'}</h3>
        <button class="iconbtn" onclick="closeModal()">✕</button>
      </div>
      <div class="mbody">
        <div class="field"><label>Name</label><input id="m_name" value="${esc(m.name)}" placeholder="e.g. Atlas Copco compressor"></div>
        <div class="grid2">
          <div class="field"><label>Type</label><select id="m_kind">${kindOpts}</select></div>
          <div class="field"><label>Track service by</label><select id="m_track" onchange="machineModeToggle()">${modeOpts}</select></div>
        </div>

        <div id="monthsWrap">
          <div class="grid2">
            <div class="field"><label>Service every (months)</label><input id="m_interval_m" type="number" min="1" value="${esc(m.interval_months || 6)}" onchange="machineRecalcNext()"></div>
            <div class="field"><label>Last service</label><input id="m_last" type="date" value="${esc(m.last_service_date)}" onchange="machineRecalcNext()"></div>
          </div>
          <div class="field"><label>Next service due</label><input id="m_next" type="date" value="${esc(m.next_service_date)}" oninput="this.dataset.touched=1"></div>
          <div class="numhint">Leave “next service due” blank to auto-set your interval after the last service.</div>
        </div>

        <div id="usageWrap" style="display:none">
          <div class="grid2">
            <div class="field"><label>Service every (<span class="unitLbl">km</span>)</label><input id="m_interval_u" type="number" min="0" value="${esc(uIntervalVal)}" onchange="machineRecalcReading()"></div>
            <div class="field"><label>Current reading (<span class="unitLbl">km</span>)</label><input id="m_current" type="number" min="0" value="${esc(m.current_reading || 0)}"></div>
          </div>
          <div class="grid2">
            <div class="field"><label>Last service at (<span class="unitLbl">km</span>)</label><input id="m_last_r" type="number" min="0" value="${esc(m.last_service_reading || 0)}" onchange="machineRecalcReading()"></div>
            <div class="field"><label>Next service at (<span class="unitLbl">km</span>)</label><input id="m_next_r" type="number" min="0" value="${esc(m.next_service_reading || 0)}" oninput="this.dataset.touched=1"></div>
          </div>
          <div class="numhint">Leave “next service at” blank to auto-set last-service reading + interval.</div>
        </div>

        <div class="grid2">
          <div class="field"><label>Location</label><input id="m_location" value="${esc(m.location)}"></div>
          <div class="field"><label>Serial number</label><input id="m_serial" value="${esc(m.serial_number)}"></div>
        </div>
        <div class="field"><label>Notes</label><textarea id="m_notes">${esc(m.notes)}</textarea></div>
        <input type="hidden" id="m_asset_id" value="${m.asset_id != null ? m.asset_id : ''}">
      </div>
      <div class="mfoot">
        ${editing ? `<button class="btn danger" onclick="deleteMachine(${id})">Delete</button>` : ''}
        <button class="btn" onclick="saveMachine(${editing ? id : 'null'})">Save</button>
      </div>`;
    $('#modalBg').classList.add('show');
    machineModeToggle();
    setTimeout(() => $('#m_name').focus(), 60);
  });
}

function machineModeToggle() {
  const mode = $('#m_track').value;
  const usage = mode === 'km' || mode === 'hours';
  $('#monthsWrap').style.display = usage ? 'none' : 'block';
  $('#usageWrap').style.display = usage ? 'block' : 'none';
  const unit = mode === 'hours' ? 'hrs' : 'km';
  document.querySelectorAll('#usageWrap .unitLbl').forEach(e => e.textContent = unit);
}

function machineRecalcNext() {
  const last = $('#m_last').value;
  const interval = parseInt($('#m_interval_m').value, 10) || 6;
  const next = $('#m_next');
  if (last && !next.dataset.touched) next.value = addMonths(last, interval);
}

function machineRecalcReading() {
  const last = parseInt($('#m_last_r').value, 10) || 0;
  const intv = parseInt($('#m_interval_u').value, 10) || 0;
  const next = $('#m_next_r');
  if (last && intv && !next.dataset.touched) next.value = last + intv;
}

async function saveMachine(id) {
  const mode = $('#m_track').value;
  const assetRaw = $('#m_asset_id').value;
  const body = {
    name: $('#m_name').value.trim(),
    kind: $('#m_kind').value,
    track_by: mode,
    location: $('#m_location').value.trim(),
    serial_number: $('#m_serial').value.trim(),
    notes: $('#m_notes').value.trim(),
    asset_id: assetRaw === '' ? null : parseInt(assetRaw, 10),
  };
  if (mode === 'months') {
    body.interval_months = parseInt($('#m_interval_m').value, 10) || 6;
    body.last_service_date = $('#m_last').value;
    body.next_service_date = $('#m_next').value;
  } else {
    const intv = parseInt($('#m_interval_u').value, 10) || 0;
    if (mode === 'km') body.interval_km = intv; else body.interval_hours = intv;
    body.last_service_reading = parseInt($('#m_last_r').value, 10) || 0;
    body.next_service_reading = parseInt($('#m_next_r').value, 10) || 0;
    body.current_reading = parseInt($('#m_current').value, 10) || 0;
  }
  if (!body.name) { toast('Name is required', 'err'); return; }
  try {
    await API(id ? '/machines/' + id : '/machines',
      { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeModal(); toast(id ? 'Machine updated' : 'Machine added', 'ok');
    loadMachines(); refreshBell();
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteMachine(id) {
  if (!confirm('Delete this machine and its service history?')) return;
  try { await API('/machines/' + id, { method: 'DELETE' }); closeModal(); toast('Deleted', 'ok'); loadMachines(); refreshBell(); }
  catch (e) { toast(e.message, 'err'); }
}

/* ---- log a service (per tracking mode) ---- */
function openLogService(id) {
  API('/machines').then(r => r.find(x => x.id === id)).then(m => {
    m = m || {};
    const today = new Date().toISOString().slice(0, 10);
    const usage = m.track_by === 'km' || m.track_by === 'hours';
    const unit = MUNIT[m.track_by] || '';
    let fields;
    if (usage) {
      const intv = (m.track_by === 'hours' ? m.interval_hours : m.interval_km) || 0;
      const cur = m.current_reading || 0;
      fields = `
        <div class="grid2">
          <div class="field"><label>Service date</label><input id="ls_date" type="date" value="${today}"></div>
          <div class="field"><label>Reading at service (${unit})</label><input id="ls_reading" type="number" min="0" value="${cur}" onchange="logReadingRecalc(${intv})"></div>
        </div>
        <div class="field"><label>Next service at (${unit})</label><input id="ls_next_r" type="number" min="0" value="${cur + intv}" oninput="this.dataset.touched=1"></div>`;
    } else {
      const intv = m.interval_months || 6;
      fields = `
        <div class="grid2">
          <div class="field"><label>Service date</label><input id="ls_date" type="date" value="${today}" onchange="logServiceRecalc(${intv})"></div>
          <div class="field"><label>Next service due</label><input id="ls_next" type="date" value="${addMonths(today, intv)}"></div>
        </div>`;
    }
    $('#modal').innerHTML = `
      <div class="mhead"><h3>Log service · ${esc(m.name || '')}</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
      <div class="mbody">
        ${fields}
        <div class="field"><label>Service type</label><input id="ls_type" value="Basic service"></div>
        <div class="grid2">
          <div class="field"><label>Performed by <span style="text-transform:none;color:var(--muted)">(optional)</span></label><input id="ls_by"></div>
          <div class="field"><label>Cost <span style="text-transform:none;color:var(--muted)">(optional)</span></label><input id="ls_cost" placeholder="e.g. R1 250"></div>
        </div>
        <div class="field"><label>Notes <span style="text-transform:none;color:var(--muted)">(optional)</span></label><textarea id="ls_notes" placeholder="What was done"></textarea></div>
        <div class="numhint">This is added to the machine’s history and rolls its next service forward.</div>
      </div>
      <div class="mfoot"><button class="btn" onclick="submitLogService(${id}, '${m.track_by || 'months'}')">Save service</button></div>`;
    $('#modalBg').classList.add('show');
    setTimeout(() => $('#ls_date').focus(), 60);
  });
}

function logServiceRecalc(interval) {
  const d = $('#ls_date').value;
  if (d) $('#ls_next').value = addMonths(d, interval || 6);
}
function logReadingRecalc(interval) {
  const r = parseInt($('#ls_reading').value, 10) || 0;
  const next = $('#ls_next_r');
  if (!next.dataset.touched) next.value = r + (interval || 0);
}

async function submitLogService(id, mode) {
  const usage = mode === 'km' || mode === 'hours';
  const body = {
    service_date: $('#ls_date').value,
    service_type: $('#ls_type').value.trim() || 'Basic service',
    performed_by: $('#ls_by').value.trim(),
    cost: $('#ls_cost').value.trim(),
    notes: $('#ls_notes').value.trim(),
  };
  if (usage) {
    body.reading = parseInt($('#ls_reading').value, 10) || 0;
    body.next_due_reading = parseInt($('#ls_next_r').value, 10) || 0;
  } else {
    body.next_due = $('#ls_next').value;
  }
  if (!body.service_date) { toast('Service date is required', 'err'); return; }
  try {
    await API('/machines/' + id + '/service', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeModal(); toast('Service logged', 'ok');
    loadMachines(); refreshBell();
    if ($('#view-dashboard').classList.contains('active')) loadDashboard();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---- quick reading update (km / hours machines) ---- */
let _machineEdit = null;
function openReading(id) {
  API('/machines').then(r => r.find(x => x.id === id)).then(m => {
    m = m || {};
    _machineEdit = m;
    const unit = MUNIT[m.track_by] || '';
    $('#modal').innerHTML = `
      <div class="mhead"><h3>Update reading · ${esc(m.name || '')}</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
      <div class="mbody">
        <div class="field"><label>Current reading (${unit})</label><input id="rd_val" type="number" min="0" value="${m.current_reading || 0}"></div>
        <div class="numhint">Updates how close this machine is to its next service.</div>
      </div>
      <div class="mfoot"><button class="btn" onclick="submitReading(${id})">Save</button></div>`;
    $('#modalBg').classList.add('show');
    setTimeout(() => $('#rd_val').focus(), 60);
  });
}

function machineToBody(m) {
  return {
    name: m.name, kind: m.kind, track_by: m.track_by || 'months',
    location: m.location || '', serial_number: m.serial_number || '',
    asset_id: m.asset_id != null ? m.asset_id : null,
    interval_months: m.interval_months || 6,
    interval_km: m.interval_km || 0, interval_hours: m.interval_hours || 0,
    last_service_date: m.last_service_date || '', next_service_date: m.next_service_date || '',
    last_service_reading: m.last_service_reading || 0, next_service_reading: m.next_service_reading || 0,
    current_reading: m.current_reading || 0, notes: m.notes || '',
  };
}

async function submitReading(id) {
  const body = machineToBody(_machineEdit || {});
  body.current_reading = parseInt($('#rd_val').value, 10) || 0;
  try {
    await API('/machines/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeModal(); toast('Reading updated', 'ok');
    loadMachines(); refreshBell();
    if ($('#view-dashboard').classList.contains('active')) loadDashboard();
  } catch (e) { toast(e.message, 'err'); }
}

async function openMachineHistory(id) {
  let hist;
  try { hist = await API('/machines/' + id + '/history'); } catch (e) { toast(e.message, 'err'); return; }
  $('#modal').innerHTML = `
    <div class="mhead"><h3>Service history</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
    <div class="mbody">
      ${!hist.length ? '<p style="color:var(--muted)">No services logged yet.</p>' :
        hist.map(h => {
          const usage = h.reading_unit === 'km' || h.reading_unit === 'hours';
          const unit = h.reading_unit === 'hours' ? 'hrs' : 'km';
          const line = usage
            ? `<b>${esc(h.service_date || '—')}</b> <span class="arr">·</span> <span class="old">${fmtNum(h.reading)} ${unit}</span>`
            : `<b>${esc(h.service_date || '—')}</b> <span class="arr">→</span> <span class="old">next ${esc(h.next_due || '—')}</span>`;
          return `
          <div class="hist-row">
            <div class="hist-line">${line}</div>
            <div class="hist-meta">${esc(h.service_type || 'Service')}${h.performed_by ? ' · ' + esc(h.performed_by) : ''}${h.cost ? ' · ' + esc(h.cost) : ''}${h.logged_at ? ' · logged ' + esc(h.logged_at.replace('T', ' ').slice(0, 16)) : ''}</div>
            ${h.notes ? `<div class="hist-note">${esc(h.notes)}</div>` : ''}
          </div>`;
        }).join('')}
    </div>`;
  $('#modalBg').classList.add('show');
}


/* ------------------------------------------------------------ settings ---- */
async function loadSettings() {
  settings = await API('/settings');
  $('#setBiz').value = settings.business_name || '';
  $('#setLead').value = settings.notify_lead_days || '60';
  if ($('#setMachineLead')) $('#setMachineLead').value = settings.machine_notify_days || '30';
  $('#setTheme').checked = settings.theme === 'light';
  if (ME) {
    $('#meName').textContent = ME.username;
    $('#meRole').textContent = ME.role === 'admin' ? 'Administrator' : 'User';
  }
  gateAdminUI();
  if (ME && ME.role === 'admin') {
    loadUsers();
    loadBackupConfig();
    try {
      const v = await API('/version');
      $('#verPill').textContent = 'v' + v.version;
      $('#repoLine').textContent = v.repo;
    } catch (e) {}
  }
}

/* ----------------------------------------------------------- checklists --- */
let CL_TEMPLATES = [];

async function loadChecklists() {
  $('#newTplBtn').style.display = (ME && ME.role === 'admin') ? '' : 'none';
  const list = $('#checklistList');
  try {
    CL_TEMPLATES = await API('/checklists/templates' + (ME && ME.role === 'admin' ? '?all=true' : ''));
  } catch (e) { return; }
  if (!CL_TEMPLATES.length) {
    list.innerHTML = emptyState('check', 'No checklists yet',
      ME && ME.role === 'admin' ? 'Tap “Template” to create one.' : 'An admin needs to add a checklist.');
    return;
  }
  list.innerHTML = CL_TEMPLATES.map(t => `
    <div class="card">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div class="name" style="font-weight:600;font-size:16px">${esc(t.name)}${t.active ? '' : ' <span class="chip">inactive</span>'}</div>
          ${t.description ? `<div class="desc" style="color:var(--muted);font-size:13px;margin-top:2px">${esc(t.description)}</div>` : ''}
          <div class="chips" style="margin-top:6px"><span class="chip">${t.items.length} items</span></div>
        </div>
        ${ME && ME.role === 'admin' ? `<button class="iconbtn" onclick='openTemplate(${t.id})' title="Edit template">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>` : ''}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn" style="flex:1" onclick="startRun(${t.id})">Start check</button>
        <button class="btn ghost" onclick="viewHistory(${t.id})">History</button>
      </div>
    </div>`).join('');
}

/* ---- run a checklist ---- */
function startRun(tplId) {
  const t = CL_TEMPLATES.find(x => x.id === tplId);
  if (!t) return;
  $('#modal').innerHTML = `
    <div class="mhead"><h3>${esc(t.name)}</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
    <div class="mbody">
      <div class="field"><label>Driver name</label><input id="run_driver" placeholder="Who's doing this check?"></div>
      ${t.ask_odometer ? `<div class="field"><label>Odometer</label><input id="run_odo" inputmode="numeric" placeholder="km"></div>` : ''}
      <div class="section-label" style="margin:14px 0 8px;font-size:12px">Items — mark each</div>
      <div id="runItems">
        ${t.items.map(it => `
          <div class="run-item" data-item="${it.id}">
            <div class="run-label">${esc(it.label)}</div>
            <div class="seg">
              <button type="button" class="seg-btn pass" onclick="setItem('${it.id}','pass')">Pass</button>
              <button type="button" class="seg-btn fail" onclick="setItem('${it.id}','fail')">Fail</button>
              <button type="button" class="seg-btn na"   onclick="setItem('${it.id}','na')">N/A</button>
            </div>
            <input class="run-note" id="note_${it.id}" placeholder="Note (optional)" style="display:none">
          </div>`).join('')}
      </div>
      <div class="field" style="margin-top:12px"><label>General notes</label><textarea id="run_notes"></textarea></div>
      <div class="numhint" id="runHint">Tip: tap Pass on everything, then flip any that fail.</div>
    </div>
    <div class="mfoot">
      <button class="btn ghost" onclick="markAllPass()">All pass</button>
      <button class="btn" onclick="submitRun(${tplId})">Submit check</button>
    </div>`;
  RUN_RESULTS = {};
  $('#modalBg').classList.add('show');
  setTimeout(() => $('#run_driver').focus(), 60);
}

let RUN_RESULTS = {};
function setItem(itemId, status) {
  RUN_RESULTS[itemId] = Object.assign({}, RUN_RESULTS[itemId], { status });
  const row = document.querySelector(`.run-item[data-item="${itemId}"]`);
  row.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('on'));
  row.querySelector('.seg-btn.' + status).classList.add('on');
  row.classList.toggle('row-fail', status === 'fail');
  const note = $('#note_' + itemId);
  note.style.display = status === 'fail' ? 'block' : note.style.display;
}
function markAllPass() {
  document.querySelectorAll('.run-item').forEach(row => setItem(row.getAttribute('data-item'), 'pass'));
}

async function submitRun(tplId) {
  const driver = $('#run_driver').value.trim();
  if (!driver) { toast('Driver name is required', 'err'); return; }
  const t = CL_TEMPLATES.find(x => x.id === tplId);
  // collect notes into results
  const results = {};
  t.items.forEach(it => {
    const r = RUN_RESULTS[it.id] || {};
    const note = ($('#note_' + it.id) || {}).value || '';
    results[it.id] = { status: r.status || 'pass', note: note.trim(), label: it.label };
  });
  const fails = Object.values(results).filter(r => r.status === 'fail').length;
  const body = {
    template_id: tplId, driver_name: driver,
    odometer: ($('#run_odo') || {}).value || '',
    results, notes: $('#run_notes').value.trim(),
  };
  try {
    await API('/checklists/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeModal();
    toast(fails ? `Submitted — ${fails} issue${fails !== 1 ? 's' : ''} flagged on the dashboard` : 'Check submitted — all good', fails ? 'err' : 'ok');
    refreshBell();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---- history ---- */
async function viewHistory(tplId) {
  const t = CL_TEMPLATES.find(x => x.id === tplId);
  let runs;
  try { runs = await API('/checklists/runs?template_id=' + tplId); } catch (e) { toast(e.message, 'err'); return; }
  $('#modal').innerHTML = `
    <div class="mhead"><h3>History</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
    <div class="mbody">
      ${!runs.length ? '<p style="color:var(--muted)">No checks recorded yet.</p>' :
        runs.map(r => `
          <div class="urow" onclick='viewRun(${r.id})' style="cursor:pointer">
            <div class="uava" style="color:${r.fail_count ? 'var(--expired)' : 'var(--valid)'}">${r.fail_count ? '!' : '✓'}</div>
            <div class="uinfo">
              <div class="un">${esc(r.driver_name)}</div>
              <div class="ur">${r.created_at.replace('T', ' ').slice(0, 16)}${r.fail_count ? ' · ' + r.fail_count + ' issue' + (r.fail_count !== 1 ? 's' : '') : ' · all pass'}</div>
            </div>
          </div>`).join('')}
    </div>`;
  $('#modalBg').classList.add('show');
}

async function viewRun(runId) {
  let r;
  try { r = await API('/checklists/runs/' + runId); } catch (e) { toast(e.message, 'err'); return; }
  const items = Object.values(r.results || {});
  const badge = s => `<span class="status ${s === 'fail' ? 'expired' : s === 'na' ? 'none' : 'valid'}">${s === 'na' ? 'N/A' : s}</span>`;
  $('#modal').innerHTML = `
    <div class="mhead"><h3>${esc(r.driver_name)}</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
    <div class="mbody">
      <div class="ur" style="color:var(--muted);font-size:13px;margin-bottom:10px">
        ${r.created_at.replace('T', ' ').slice(0, 16)}${r.odometer ? ' · ' + esc(r.odometer) + ' km' : ''}
      </div>
      ${items.map(it => `
        <div class="run-item" style="border:0;padding:8px 0">
          <div class="run-label">${esc(it.label || '')}</div>
          ${badge(it.status)}
          ${it.note ? `<div style="flex-basis:100%;color:var(--muted);font-size:12px;margin-top:2px">${esc(it.note)}</div>` : ''}
        </div>`).join('')}
      ${r.notes ? `<div class="field" style="margin-top:12px"><label>Notes</label><div>${esc(r.notes)}</div></div>` : ''}
    </div>
    ${ME && ME.role === 'admin' ? `<div class="mfoot"><button class="btn danger" onclick="deleteRun(${runId})">Delete record</button></div>` : ''}`;
  $('#modalBg').classList.add('show');
}

async function deleteRun(runId) {
  if (!confirm('Delete this check record?')) return;
  try { await API('/checklists/runs/' + runId, { method: 'DELETE' }); closeModal(); toast('Deleted', 'ok'); refreshBell(); }
  catch (e) { toast(e.message, 'err'); }
}

/* ---- admin: template editor ---- */
function openTemplate(id) {
  const editing = id != null;
  const t = editing ? CL_TEMPLATES.find(x => x.id === id) : { name: '', description: '', items: [], ask_odometer: true, active: true };
  const itemsText = (t.items || []).map(i => i.label).join('\n');
  $('#modal').innerHTML = `
    <div class="mhead"><h3>${editing ? 'Edit template' : 'New template'}</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
    <div class="mbody">
      <div class="field"><label>Name</label><input id="tpl_name" value="${esc(t.name)}" placeholder="e.g. Truck — Daily Vehicle Check"></div>
      <div class="field"><label>Description</label><input id="tpl_desc" value="${esc(t.description)}"></div>
      <div class="field"><label>Checklist items (one per line)</label><textarea id="tpl_items" style="min-height:200px">${esc(itemsText)}</textarea></div>
      <div class="set-row" style="border:0;padding:6px 0">
        <div class="info"><div class="t">Ask for odometer</div></div>
        <div class="ctrl" style="min-width:auto"><label class="switch"><input type="checkbox" id="tpl_odo" ${t.ask_odometer ? 'checked' : ''}><span class="track"></span></label></div>
      </div>
      <div class="set-row" style="border:0;padding:6px 0">
        <div class="info"><div class="t">Active</div><div class="d">Show this checklist to drivers</div></div>
        <div class="ctrl" style="min-width:auto"><label class="switch"><input type="checkbox" id="tpl_active" ${t.active ? 'checked' : ''}><span class="track"></span></label></div>
      </div>
    </div>
    <div class="mfoot">
      ${editing ? `<button class="btn danger" onclick="deleteTemplate(${id})">Delete</button>` : ''}
      <button class="btn" onclick="saveTemplate(${editing ? id : 'null'})">Save</button>
    </div>`;
  $('#modalBg').classList.add('show');
}

async function saveTemplate(id) {
  const items = $('#tpl_items').value.split('\n').map(s => s.trim()).filter(Boolean);
  const body = {
    name: $('#tpl_name').value.trim(),
    description: $('#tpl_desc').value.trim(),
    items,
    ask_odometer: $('#tpl_odo').checked,
    active: $('#tpl_active').checked,
  };
  if (!body.name) { toast('Name is required', 'err'); return; }
  if (!items.length) { toast('Add at least one item', 'err'); return; }
  try {
    await API(id ? '/checklists/templates/' + id : '/checklists/templates',
      { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeModal(); toast(id ? 'Template saved' : 'Template created', 'ok'); loadChecklists();
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template? Past records stay, but the checklist disappears.')) return;
  try { await API('/checklists/templates/' + id, { method: 'DELETE' }); closeModal(); toast('Template deleted', 'ok'); loadChecklists(); }
  catch (e) { toast(e.message, 'err'); }
}

/* -------------------------------------------------------------- backup ---- */
async function loadBackupConfig() {
  if (!ME || ME.role !== 'admin') return;
  try {
    const c = await API('/backup/config');
    $('#bkDaily').checked = !!c.daily;
    $('#bkHost').value = c.host || '';
    $('#bkShare').value = c.share || '';
    $('#bkPath').value = c.path || '';
    $('#bkUser').value = c.user || '';
    $('#bkPass').value = '';
    $('#bkPass').placeholder = c.has_password ? '•••••• (saved)' : 'password';
    $('#bkKeep').value = String(c.keep || 2);
    renderBackupStatus(c);
  } catch (e) {}
}

function renderBackupStatus(c) {
  const el = $('#bkStatus');
  if (!el) return;
  let s = c.daily ? `On · daily · keep ${c.keep}` : 'Off — turn on for a daily copy';
  if (c.last_backup_at) s += ` · last ${c.last_backup_at.replace('T', ' ').slice(0, 16)}`;
  if (c.last_backup_status && /fail/i.test(c.last_backup_status)) s += ' ⚠';
  el.textContent = s;
}

function backupPayload() {
  return {
    host: $('#bkHost').value.trim(),
    share: $('#bkShare').value.trim(),
    path: $('#bkPath').value.trim(),
    user: $('#bkUser').value.trim(),
    password: $('#bkPass').value,        // blank keeps existing
    keep: parseInt($('#bkKeep').value, 10),
    daily: $('#bkDaily').checked,
  };
}

async function saveBackupConfig(announce) {
  try {
    const c = await API('/backup/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backupPayload()),
    });
    $('#bkPass').value = '';
    $('#bkPass').placeholder = c.has_password ? '•••••• (saved)' : 'password';
    renderBackupStatus(c);
    if (announce) toast('Backup settings saved', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function testBackup() {
  await saveBackupConfig(false);
  toast('Testing connection…');
  try {
    const r = await API('/backup/test', { method: 'POST' });
    toast(r.message, r.ok ? 'ok' : 'err');
  } catch (e) { toast(e.message, 'err'); }
}

async function backupNow() {
  await saveBackupConfig(false);
  toast('Backing up…');
  try {
    const r = await API('/backup/now', { method: 'POST' });
    toast(r.message, r.ok ? 'ok' : 'err');
    if (r.ok) loadBackupConfig();
  } catch (e) { toast(e.message, 'err'); }
}

function openReportView(html) {
  $('#reportContent').innerHTML = html;
  $('#reportOverlay').classList.add('show');
  document.body.classList.add('report-open');
  $('.report-scroll').scrollTop = 0;
}
function closeReport() {
  $('#reportOverlay').classList.remove('show');
  document.body.classList.remove('report-open');
}
async function assetReport(id) {
  toast('Building report…');
  try { openReportView((await API('/reports/asset/' + id)).html); }
  catch (e) { toast(e.message, 'err'); }
}
async function compReport(id) {
  toast('Building report…');
  try { openReportView((await API('/reports/compliance/' + id)).html); }
  catch (e) { toast(e.message, 'err'); }
}
async function reportAll(kind) {
  toast('Building report…');
  try {
    const ep = kind === 'assets' ? '/reports/assets' : '/reports/compliance';
    openReportView((await API(ep)).html);
  } catch (e) { toast(e.message, 'err'); }
}

function exportCSV(kind) {
  toast('Exporting…');
  fetch(`/api/export/${kind}.csv`, { headers: { Authorization: 'Bearer ' + TOKEN } })
    .then(r => { if (!r.ok) throw new Error('Export failed'); return r.blob(); })
    .then(b => triggerDownload(b, `assetiq-${kind}.csv`))
    .catch(e => toast(e.message, 'err'));
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

function downloadBackup() {
  toast('Preparing download…');
  fetch('/api/backup/download', { headers: { Authorization: 'Bearer ' + TOKEN } })
    .then(r => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
    .then(b => {
      const d = new Date(), p = n => String(n).padStart(2, '0');
      triggerDownload(b, `assetiq-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.zip`);
    })
    .catch(e => toast(e.message, 'err'));
}

async function restoreFromFile(input) {
  const file = input.files[0]; input.value = '';
  if (!file) return;
  if (!confirm(`Restore from "${file.name}"? This replaces ALL current data and signs everyone out.`)) return;
  const fd = new FormData(); fd.append('file', file);
  toast('Restoring…');
  try {
    const r = await fetch('/api/backup/restore', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'Restore failed');
    toast(d.message || 'Restored — reloading', 'ok');
    setTimeout(() => location.reload(), 1500);
  } catch (e) { toast(e.message, 'err'); }
}

async function restoreFromShare() {
  let list;
  toast('Reading share…');
  try { list = await API('/backup/list'); } catch (e) { toast(e.message, 'err'); return; }
  if (!list.ok) { toast(list.message || 'Could not read the share', 'err'); return; }
  if (!list.backups.length) { toast('No backups found on the share', 'err'); return; }
  $('#modal').innerHTML = `
    <div class="mhead"><h3>Restore from share</h3><button class="iconbtn" onclick="closeModal()">✕</button></div>
    <div class="mbody">
      <p style="color:var(--muted);font-size:13px;margin-top:0">Pick a backup. This replaces all current data and signs everyone out.</p>
      ${list.backups.map(n => `
        <div class="urow">
          <div class="uinfo"><div class="un" style="font-family:var(--mono);font-size:13px">${esc(n.replace('assetiq-backup-', '').replace('.zip', ''))}</div></div>
          <button class="btn small" onclick="doRestoreShare('${esc(n)}')">Restore</button>
        </div>`).join('')}
    </div>`;
  $('#modalBg').classList.add('show');
}

async function doRestoreShare(filename) {
  if (!confirm('Restore ' + filename + '? This replaces ALL current data.')) return;
  toast('Restoring…');
  try {
    await API('/backup/restore-samba', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
    toast('Restored — reloading', 'ok');
    setTimeout(() => location.reload(), 1500);
  } catch (e) { toast(e.message, 'err'); }
}

async function saveSetting(key, value) {
  const payload = {};
  payload[key] = (key === 'notify_lead_days' || key === 'machine_notify_days') ? parseInt(value, 10) : value;
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
const UPD_STEPS = [
  ['check', 'Checking for a new version'],
  ['download', 'Downloading & applying files'],
  ['restart', 'Restarting the server'],
  ['ready', 'Coming back online'],
];

function renderUpdSteps(activeKey, doneKeys = []) {
  $('#updSteps').innerHTML = UPD_STEPS.map(([k, label]) => {
    const cls = doneKeys.includes(k) ? 'done' : (k === activeKey ? 'active' : '');
    const mark = doneKeys.includes(k) ? '✓' : '';
    return `<div class="upd-step ${cls}"><span class="dot">${mark}</span><span>${label}</span></div>`;
  }).join('');
}
function setUpdProgress(pct, phase) {
  $('#updFill').style.width = pct + '%';
  $('#updPct').textContent = Math.round(pct) + '%';
  $('#updRingBar').style.strokeDashoffset = String(176 - (176 * pct / 100));
  if (phase) $('#updPhase').textContent = phase;
}

async function doUpdate() {
  const btn = $('#updBtn');
  if (updateState === 'check') {
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const r = await API('/update/check');
      if (r.error) { $('#updMsg').textContent = 'Could not reach GitHub: ' + r.error; btn.textContent = 'Check'; }
      else if (r.update_available) {
        $('#updTitle').textContent = `Update available — v${r.latest}`;
        $('#updMsg').textContent = `You're on v${r.current}. Tap to install.`;
        btn.textContent = `Update to v${r.latest}`; updateState = 'apply';
      } else {
        $('#updMsg').textContent = `You're on the latest version (v${r.current}).`;
        btn.textContent = 'Check';
      }
    } catch (e) { toast(e.message, 'err'); btn.textContent = 'Check'; }
    btn.disabled = false;
    return;
  }
  runUpdate();
}

async function runUpdate() {
  const before = ($('#verPill').textContent || '').replace('v', '').trim();
  const latest = (($('#updTitle').textContent || '').match(/v([\d.]+)/) || [])[1] || '';
  $('#updError').textContent = '';
  $('#updVer').innerHTML = before ? `v${before} &nbsp;→&nbsp; <b>v${latest || '…'}</b>` : '';
  $('#updateOverlay').classList.add('show');
  renderUpdSteps('check');
  setUpdProgress(8, 'Starting update…');

  // Step 1 → 2: kick off the server-side download+apply.
  renderUpdSteps('download', ['check']);
  setUpdProgress(30, 'Downloading and applying the new version…');
  let resp;
  try {
    resp = await API('/update', { method: 'POST' });
  } catch (e) {
    // The server may drop the connection as it restarts mid-request — treat
    // that as "applied, now restarting" and move to polling.
    resp = { ok: true, message: 'Applied — restarting' };
  }
  if (resp && resp.ok === false) {
    $('#updError').textContent = resp.message || 'Update failed';
    setUpdProgress(0, 'Update could not be applied');
    setTimeout(() => $('#updateOverlay').classList.remove('show'), 3500);
    return;
  }

  // Step 3: server restarts (entrypoint reinstalls deps, so this can take a bit).
  renderUpdSteps('restart', ['check', 'download']);
  setUpdProgress(55, 'Restarting — installing any new components…');

  // Step 4: poll until the server answers again with a (hopefully newer) version.
  const back = await waitForServer(before);
  renderUpdSteps('ready', ['check', 'download', 'restart']);
  if (back.ok) {
    renderUpdSteps(null, ['check', 'download', 'restart', 'ready']);
    setUpdProgress(100, `Back online${back.version ? ' on v' + back.version : ''} — reloading…`);
    setTimeout(() => location.reload(true), 1200);
  } else {
    setUpdProgress(80, 'Taking longer than expected');
    $('#updError').textContent = 'The server hasn\'t come back yet. It may still be installing — this page will reload automatically once it does.';
    // keep polling quietly, then reload when it returns
    const back2 = await waitForServer(before, 60);
    if (back2.ok) location.reload(true);
    else $('#updError').textContent = 'Still down after a few minutes. Check the container logs (docker compose logs).';
  }
}

// Poll /health (public) until the server answers again, then read the version.
// Tries for ~tries*2 seconds.
async function waitForServer(beforeVersion, tries = 90) {
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const cur = parseFloat($('#updFill').style.width) || 55;
    if (cur < 92) setUpdProgress(Math.min(92, cur + 1.5));
    try {
      const h = await fetch('/health', { cache: 'no-store' });
      if (h.ok) {
        let version = '';
        try {
          const r = await fetch('/api/version', { headers: { Authorization: 'Bearer ' + TOKEN }, cache: 'no-store' });
          if (r.ok) version = (await r.json()).version;
        } catch (e) {}
        return { ok: true, version };
      }
    } catch (e) { /* still down */ }
  }
  return { ok: false };
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
  ['usersLabel', 'usersCard', 'backupLabel', 'backupCard', 'softwareLabel', 'updateCard'].forEach(idv => {
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
