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
  certificate: 'Certificate', warranty: 'Warranty', checklist: 'Checklist', other: 'Other',
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
  list.innerHTML = rows.map(a => {
    const w = warrantyMeta(a.warranty_expiry);
    return `
    <div class="card asset">
      ${a.has_photo
        ? `<div class="thumb" data-photo="${a.id}" onclick="viewPhoto(${a.id})"></div>`
        : `<div class="tag">${String(a.asset_no).padStart(3, '0')}</div>`}
      <div class="meta">
        <div class="name">${a.has_photo ? `<span class="mono" style="color:var(--accent)">#${String(a.asset_no).padStart(3, '0')}</span> ` : ''}${esc(a.name)}</div>
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
        <button class="iconbtn" onclick='openAsset(${a.id})' title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
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

function openAsset(id) {
  const editing = id != null;
  API('/assets').then(list => {
    const a = editing ? (list.find(x => x.id === id) || {}) : {};
    const used = new Set(list.map(x => x.asset_no).filter(n => n != null));
    if (editing && a.asset_no != null) used.delete(a.asset_no);  // its own number is free to keep
    let max = 0; used.forEach(n => { if (n > max) max = n; });
    let next = 1; while (used.has(next)) next++;
    const freed = [];
    for (let n = 1; n < next; n++) if (!used.has(n)) freed.push(n);  // gaps below next
    const suggested = editing ? (a.asset_no ?? next) : next;
    // Quick-pick: any freed/gap numbers, plus the next new number.
    const picks = [...new Set([...freed, next, suggested])].sort((x, y) => x - y).slice(0, 14);
    const hint = editing
      ? 'Edit the number, or tap a free one below to reassign.'
      : (freed.length ? 'Set to the next free number — tap a freed one to reuse it.' : 'Next free number. Change it if you want.');

    $('#modal').innerHTML = `
      <div class="mhead">
        <h3>${editing ? 'Edit asset' : 'New asset'}</h3>
        <button class="iconbtn" onclick="closeModal()">✕</button>
      </div>
      <div class="mbody">
        <div class="grid2">
          <div class="field">
            <label>Label number</label>
            <input id="f_asset_no" type="number" min="1" value="${suggested}">
          </div>
          <div class="field"><label>Category</label><input id="f_category" value="${esc(a.category)}" placeholder="Furniture / Tool…"></div>
        </div>
        <div class="numhint">${hint}</div>
        <div class="numchips">${picks.map(n =>
          `<button type="button" class="numchip${n === suggested ? ' on' : ''}${freed.includes(n) ? ' free' : ''}" onclick="setAssetNo(${n})">${String(n).padStart(3, '0')}</button>`
        ).join('')}</div>
        <div class="field" style="margin-top:14px"><label>Name</label><input id="f_name" value="${esc(a.name)}" placeholder="e.g. Office chair – Roxanne"></div>
        <div class="field"><label>Description</label><input id="f_description" value="${esc(a.description)}"></div>
        <div class="grid2">
          <div class="field"><label>Location</label><input id="f_location" value="${esc(a.location)}"></div>
          <div class="field"><label>Assigned to</label><input id="f_assigned_to" value="${esc(a.assigned_to)}"></div>
        </div>
        <div class="field"><label>Serial number</label><input id="f_serial_number" value="${esc(a.serial_number)}"></div>

        <div class="field"><label>Photo</label>
          <div class="photo-pick">
            <div class="preview ${a.has_photo ? '' : 'empty'}" id="photoPreview" ${a.has_photo ? `data-photo="${id}"` : ''}>${a.has_photo ? '' : 'No photo'}</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <button type="button" class="btn ghost small" onclick="document.getElementById('photoInput').click()">${a.has_photo ? 'Replace' : 'Add photo'}</button>
              <button type="button" class="btn ghost small" id="photoRemoveBtn" onclick="removePhoto()" style="${a.has_photo ? '' : 'display:none'}">Remove</button>
            </div>
            <input type="file" id="photoInput" accept="image/*" capture="environment" style="display:none" onchange="pickPhoto(this)">
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
    assetPhoto = undefined;            // unchanged until the user picks/removes
    $('#modalBg').classList.add('show');
    if (a.has_photo) loadPreviewThumb(id);
    setTimeout(() => $('#f_name').focus(), 60);
  });
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
  document.querySelectorAll('.numchip').forEach(c =>
    c.classList.toggle('on', parseInt(c.textContent, 10) === n));
}

async function saveAsset(id) {
  const body = {};
  ['name', 'description', 'category', 'location', 'serial_number', 'assigned_to', 'notes',
   'purchase_date', 'cost', 'supplier', 'warranty_expiry']
    .forEach(k => body[k] = $('#f_' + k).value.trim());
  const noVal = $('#f_asset_no').value.trim();
  body.asset_no = noVal ? parseInt(noVal, 10) : null;
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
