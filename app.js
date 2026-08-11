// ── SUPABASE CLIENT ─────────────────────────────────────────────────────────
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── STATE ────────────────────────────────────────────────────────────────────
let EVENTS = [];          // all events from DB: {id, year, month, day, en1, en2, ar, category, owner, size}
let editMode = false;
let activeFilter = 'all';
let ownerFilter = 'all';
let sizeFilter = 'all';
let searchQuery = '';

const SIZE_META = { S: 'Small', M: 'Medium', L: 'Large' };

const MONTH_DEFS = [
  { m:6,  y:2026, hijri:'Muharram 1448',                    theme:'New Beginnings — Summer Semester' },
  { m:7,  y:2026, hijri:'Muharram–Safar 1448',               theme:'Reflection & Growth — Mid Summer' },
  { m:8,  y:2026, hijri:'Safar–Rabi al-Awwal 1448',          theme:'Fall Welcome — New Academic Year' },
  { m:9,  y:2026, hijri:'Rabi al-Awwal–Rabi al-Thani 1448',  theme:'Launch — Fall Semester Kickoff' },
  { m:10, y:2026, hijri:'Rabi al-Thani–Jumada al-Ula 1448',  theme:'Intellectual & Spiritual Depth' },
  { m:11, y:2026, hijri:'Jumada al-Ula–Jumada al-Thani 1448', theme:'Community, Charity & Qiyam' },
  { m:12, y:2026, hijri:'Jumada al-Thani–Rajab 1448',        theme:'Finals, Reflection & Winter Break' },
  { m:1,  y:2027, hijri:'Rajab 1448',                        theme:'New Year — Spring Preparation' },
  { m:2,  y:2027, hijri:"Rajab–Sha'ban 1448",                theme:"Sha'ban — Prepare Your Heart for Ramadan" },
  { m:3,  y:2027, hijri:"Sha'ban–Ramadan 1448",              theme:'Ramadan Mubarak 🌙' },
  { m:4,  y:2027, hijri:'Shawwal–Dhul Qadah 1448',           theme:'Spring in Full Bloom' },
  { m:5,  y:2027, hijri:'Dhul Qadah–Dhul Hijjah 1448',       theme:'Finals, Farewell & Eid al-Adha' },
];

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES_SHORT = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

// Built-in categories (cannot be removed). Custom ones added via Manage Calendars
// are stored in localStorage and merged in at runtime.
const BUILTIN_CATEGORIES = {
  S:    { label: 'Spiritual',     icon: '🕌', color: '#30B0C7', builtin: true },
  ATH:  { label: 'Athletic',      icon: '🏃', color: '#FF9500', builtin: true },
  INT:  { label: 'Intellectual',  icon: '💡', color: '#AF52DE', builtin: true },
  HUGE: { label: 'Huge Event',    icon: '⭐', color: '#FF3B30', builtin: true },
  SC:   { label: 'Social',        icon: '🤝', color: '#34C759', builtin: true },
  OFF:  { label: 'No Classes',    icon: '🚫', color: '#8E8E93', builtin: true },
  WED:  { label: 'Wed Series',    icon: '📅', color: '#5856D6', builtin: true },
  HALAQA: { label: 'Halaqa',      icon: '🕋', color: '#00B0A6', builtin: true },
  RAZAN:  { label: "Razan — Content", icon: '🎬', color: '#FF2D55', builtin: true },
};

// Custom categories & edits to built-in ones are stored in Supabase (app_settings
// table, key='categories') so every visitor sees the same calendars — not just
// the browser that made the change.
let CATEGORY_OVERRIDES = {};   // edits to built-in categories: {KEY: {icon,label,color}}
let CUSTOM_CATEGORIES = {};    // fully custom calendars: {KEY: {icon,label,color,builtin:false}}
let PEOPLE = [];               // ['Name', ...]

async function loadSharedSettings() {
  const { data, error } = await sb.from('app_settings').select('*').in('key', ['category_overrides','custom_categories']);
  if (!error && data) {
    data.forEach(row => {
      if (row.key === 'category_overrides') CATEGORY_OVERRIDES = row.value || {};
      if (row.key === 'custom_categories') CUSTOM_CATEGORIES = row.value || {};
    });
  }
  const { data: peopleRows, error: peopleErr } = await sb.from('people').select('name').order('name');
  if (!peopleErr && peopleRows) PEOPLE = peopleRows.map(r => r.name);
}

async function saveCategoryOverrides() {
  await sb.from('app_settings').upsert({ key: 'category_overrides', value: CATEGORY_OVERRIDES });
}
async function saveCustomCategories() {
  await sb.from('app_settings').upsert({ key: 'custom_categories', value: CUSTOM_CATEGORIES });
}

function getAllCategories() {
  const merged = Object.assign({}, BUILTIN_CATEGORIES);
  Object.keys(CATEGORY_OVERRIDES).forEach(key => {
    if (merged[key]) merged[key] = Object.assign({}, merged[key], CATEGORY_OVERRIDES[key]);
  });
  return Object.assign(merged, CUSTOM_CATEGORIES);
}

// ── PEOPLE (responsible / owner) ─────────────────────────────────────────────
function loadPeople() { return PEOPLE; }

async function addPerson(name) {
  if (PEOPLE.some(p => p.toLowerCase() === name.toLowerCase())) return false;
  const { error } = await sb.from('people').insert({ name });
  if (error) { showToast('Failed to add person.', true); console.error(error); return false; }
  PEOPLE.push(name);
  PEOPLE.sort();
  return true;
}
async function removePerson(name) {
  const { error } = await sb.from('people').delete().eq('name', name);
  if (error) { showToast('Failed to remove person.', true); console.error(error); return; }
  PEOPLE = PEOPLE.filter(p => p !== name);
}

// ── DATA LOADING ─────────────────────────────────────────────────────────────
async function loadEvents() {
  await loadSharedSettings();
  const { data, error } = await sb.from('events').select('*').order('year').order('month').order('day');
  if (error) {
    console.error('Load error:', error);
    showToast('Failed to load events. Check connection.', true);
    return;
  }
  EVENTS = data || [];

  if (EVENTS.length === 0 && typeof ALL_SEED_EVENTS !== 'undefined') {
    await seedDatabase();
  } else {
    rebuildFilterChips();
    rebuildOwnerFilter();
    renderAll();
  }
}

async function seedDatabase() {
  showToast('Setting up calendar for the first time…');
  const { error } = await sb.from('events').insert(ALL_SEED_EVENTS);
  if (error) {
    console.error('Seed error:', error);
    showToast('Setup failed — please refresh.', true);
    return;
  }
  await loadEvents();
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
async function addEvent(ev) {
  const { data, error } = await sb.from('events').insert([ev]).select();
  if (error) { showToast('Failed to add event.', true); console.error(error); return null; }
  EVENTS.push(data[0]);
  renderAll();
  showToast('Event added ✓');
  return data[0];
}

async function updateEvent(id, fields) {
  const { error } = await sb.from('events').update(fields).eq('id', id);
  if (error) { showToast('Failed to update event.', true); console.error(error); return; }
  const idx = EVENTS.findIndex(e => e.id === id);
  if (idx > -1) EVENTS[idx] = { ...EVENTS[idx], ...fields };
  renderAll();
  showToast('Event updated ✓');
}

async function deleteEvent(id) {
  const { error } = await sb.from('events').delete().eq('id', id);
  if (error) { showToast('Failed to delete event.', true); console.error(error); return; }
  EVENTS = EVENTS.filter(e => e.id !== id);
  renderAll();
  showToast('Event removed ✓');
}

// ── TOAST ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ── SHEET HELPERS ────────────────────────────────────────────────────────────
function openSheet(id) { document.getElementById(id).classList.add('show'); }
function closeSheet(id) { document.getElementById(id).classList.remove('show'); }

// ── EDIT MODE / PASSCODE ─────────────────────────────────────────────────────
let pendingAfterUnlock = null; // 'manage' if opened via fab before unlocked (fab only shows when editMode true, so unused, kept for safety)

function openPasscodeModal() {
  openSheet('passcode-modal');
  document.getElementById('passcode-input').value = '';
  setTimeout(() => document.getElementById('passcode-input').focus(), 200);
  document.getElementById('passcode-error').style.display = 'none';
}
function closePasscodeModal() { closeSheet('passcode-modal'); }

function tryPasscode() {
  const val = document.getElementById('passcode-input').value;
  if (val === EDIT_PASSCODE) {
    editMode = true;
    closePasscodeModal();
    document.body.classList.add('edit-mode');
    const btn = document.getElementById('edit-toggle-btn');
    btn.classList.add('active');
    document.getElementById('fab-manage-btn').style.display = 'flex';
    renderAll();
    showToast('Edit mode unlocked ✓');
  } else {
    document.getElementById('passcode-error').style.display = 'block';
  }
}
function toggleEditMode() {
  if (editMode) {
    editMode = false;
    document.body.classList.remove('edit-mode');
    document.getElementById('edit-toggle-btn').classList.remove('active');
    document.getElementById('fab-manage-btn').style.display = 'none';
    renderAll();
  } else {
    openPasscodeModal();
  }
}

// ── EVENT FORM SHEET (Add / Edit) ────────────────────────────────────────────
let formContext = null; // {mode: 'add'|'edit', year, month, day, id, data}

function populateCategorySelect() {
  const sel = document.getElementById('event-cat');
  sel.innerHTML = '';
  const cats = getAllCategories();
  Object.keys(cats).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${cats[key].icon} ${cats[key].label}`;
    sel.appendChild(opt);
  });
}

let selectedOwners = []; // working state while the event form is open

function renderOwnerTagPicker(initialOwners) {
  selectedOwners = (initialOwners || []).slice();
  const wrap = document.getElementById('event-owners-tags');
  wrap.innerHTML = '';
  const people = loadPeople();
  if (people.length === 0) {
    wrap.innerHTML = '<div class="owner-tag-empty">No people added yet — add some in Manage → People.</div>';
    return;
  }
  people.forEach(name => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'owner-tag-option' + (selectedOwners.includes(name) ? ' selected' : '');
    btn.textContent = name;
    btn.addEventListener('click', () => {
      if (selectedOwners.includes(name)) {
        selectedOwners = selectedOwners.filter(n => n !== name);
        btn.classList.remove('selected');
      } else {
        selectedOwners.push(name);
        btn.classList.add('selected');
      }
    });
    wrap.appendChild(btn);
  });
}

function openEventForm(ctx) {
  formContext = ctx;
  populateCategorySelect();
  const isEdit = ctx.mode === 'edit';
  document.getElementById('event-modal-title').textContent = isEdit ? 'Edit Event' : 'Add Event';
  document.getElementById('event-date-label').textContent =
    `${MONTH_NAMES[ctx.month-1]} ${ctx.day}, ${ctx.year}`;

  document.getElementById('event-en1').value = isEdit ? ctx.data.en1 : '';
  document.getElementById('event-en2').value = isEdit ? (ctx.data.en2 || '') : '';
  document.getElementById('event-ar').value  = isEdit ? (ctx.data.ar || '') : '';
  document.getElementById('event-cat').value = isEdit ? ctx.data.category : 'SC';
  renderOwnerTagPicker(isEdit ? getEventOwners(ctx.data) : []);
  document.getElementById('event-size').value = isEdit ? (ctx.data.size || 'M') : 'M';
  document.getElementById('event-notes').value = isEdit ? (ctx.data.notes || '') : '';

  document.getElementById('event-delete-btn').style.display = isEdit ? 'block' : 'none';
  openSheet('event-modal');
  setTimeout(() => document.getElementById('event-en1').focus(), 200);
}
function closeEventForm() { closeSheet('event-modal'); formContext = null; }

// Reads the owners array off an event, falling back to the legacy single
// "owner" string field for events saved before multi-tagging existed.
function getEventOwners(ev) {
  if (Array.isArray(ev.owners) && ev.owners.length) return ev.owners;
  if (ev.owner) return [ev.owner];
  return [];
}

async function submitEventForm() {
  const en1 = document.getElementById('event-en1').value.trim();
  const en2 = document.getElementById('event-en2').value.trim();
  const ar  = document.getElementById('event-ar').value.trim();
  const category = document.getElementById('event-cat').value;
  const owners = selectedOwners.slice();
  const owner = owners[0] || ''; // legacy field kept in sync for any old code paths
  const size = document.getElementById('event-size').value;
  const notes = document.getElementById('event-notes').value.trim();

  if (!en1) { showToast('Event title is required.', true); return; }

  if (formContext.mode === 'add') {
    await addEvent({ year: formContext.year, month: formContext.month, day: formContext.day, en1, en2, ar, category, owner, owners, size, notes });
  } else {
    await updateEvent(formContext.id, { en1, en2, ar, category, owner, owners, size, notes });
  }
  closeEventForm();
}
async function deleteFromForm() {
  if (!formContext || formContext.mode !== 'edit') return;
  if (!confirm('Remove this event?')) return;
  await deleteEvent(formContext.id);
  closeEventForm();
}

// ── MANAGE SHEET (Calendars + People) ────────────────────────────────────────
function openManageModal() {
  renderCalendarList();
  renderPeopleList();
  switchManageTab('calendars');
  openSheet('manage-modal');
}
function closeManageModal() { closeSheet('manage-modal'); rebuildFilterChips(); rebuildOwnerFilter(); renderAll(); }

function switchManageTab(tab) {
  document.querySelectorAll('.manage-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('manage-tab-calendars').style.display = tab === 'calendars' ? 'block' : 'none';
  document.getElementById('manage-tab-people').style.display = tab === 'people' ? 'block' : 'none';
}

function renderCalendarList() {
  const wrap = document.getElementById('calendar-list');
  wrap.innerHTML = '';
  const cats = getAllCategories();
  Object.keys(cats).forEach(key => {
    const c = cats[key];
    const row = document.createElement('div');
    row.className = 'calendar-row';
    row.innerHTML = `
      <span class="cal-dot" style="background:${c.color}"></span>
      <span class="cal-icon">${c.icon}</span>
      <span class="cal-label">${escapeHtml(c.label)}</span>
      ${c.builtin ? '<span class="cal-builtin-tag">Built-in</span>' : ''}
    `;
    const editBtn = document.createElement('button');
    editBtn.className = 'cal-edit-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openEditCalendarModal(key, c));
    row.appendChild(editBtn);
    if (!c.builtin) {
      const btn = document.createElement('button');
      btn.className = 'cal-remove-btn';
      btn.textContent = 'Remove';
      btn.addEventListener('click', () => removeCustomCategory(key));
      row.appendChild(btn);
    }
    wrap.appendChild(row);
  });
}

function renderPeopleList() {
  const wrap = document.getElementById('people-list');
  wrap.innerHTML = '';
  const people = loadPeople();
  if (people.length === 0) {
    wrap.innerHTML = '<div class="cal-builtin-tag" style="padding:10px 4px;">No people added yet.</div>';
    return;
  }
  people.forEach(name => {
    const row = document.createElement('div');
    row.className = 'calendar-row';
    row.innerHTML = `<span class="cal-label">${escapeHtml(name)}</span>`;
    const btn = document.createElement('button');
    btn.className = 'cal-remove-btn';
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      await removePerson(name);
      renderPeopleList();
      rebuildOwnerFilter();
      showToast('Person removed ✓');
    });
    row.appendChild(btn);
    wrap.appendChild(row);
  });
}

// ── EDIT CALENDAR SHEET ───────────────────────────────────────────────────────
let editingCalKey = null;
function openEditCalendarModal(key, c) {
  editingCalKey = key;
  document.getElementById('edit-cal-key').value = key;
  document.getElementById('edit-cal-icon').value = c.icon;
  document.getElementById('edit-cal-label').value = c.label;
  document.getElementById('edit-cal-color').value = c.color;
  openSheet('edit-cal-modal');
}
function closeEditCalendarModal() { closeSheet('edit-cal-modal'); editingCalKey = null; }

async function saveEditedCalendar() {
  const key = editingCalKey;
  if (!key) return;
  const icon = document.getElementById('edit-cal-icon').value.trim() || '🔹';
  const label = document.getElementById('edit-cal-label').value.trim();
  const color = document.getElementById('edit-cal-color').value;
  if (!label) { showToast('Calendar name is required.', true); return; }

  const isBuiltin = !!BUILTIN_CATEGORIES[key];
  if (isBuiltin) {
    CATEGORY_OVERRIDES[key] = { icon, label, color };
    await saveCategoryOverrides();
  } else if (CUSTOM_CATEGORIES[key]) {
    CUSTOM_CATEGORIES[key] = Object.assign({}, CUSTOM_CATEGORIES[key], { icon, label, color });
    await saveCustomCategories();
  }
  closeEditCalendarModal();
  renderCalendarList();
  showToast('Calendar updated ✓');
}

function slugify(label) {
  return 'CUST_' + label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20) + '_' + Date.now().toString(36).slice(-4);
}

async function addCustomCategory() {
  const icon = document.getElementById('new-cal-icon').value.trim() || '🔹';
  const label = document.getElementById('new-cal-label').value.trim();
  const color = document.getElementById('new-cal-color').value;
  if (!label) { showToast('Enter a calendar name.', true); return; }

  const key = slugify(label);
  CUSTOM_CATEGORIES[key] = { label, icon, color, builtin: false };
  await saveCustomCategories();

  document.getElementById('new-cal-label').value = '';
  document.getElementById('new-cal-icon').value = '';
  renderCalendarList();
  showToast('Calendar added ✓');
}

async function removeCustomCategory(key) {
  const inUse = EVENTS.some(e => e.category === key);
  if (inUse && !confirm('Some events use this calendar. Remove it anyway? Those events will keep their tag but show as uncategorized styling.')) return;
  delete CUSTOM_CATEGORIES[key];
  await saveCustomCategories();
  renderCalendarList();
  rebuildFilterChips();
  showToast('Calendar removed ✓');
}

// ── FILTER CHIPS (dynamic, includes custom calendars) ────────────────────────
function rebuildFilterChips() {
  const row = document.getElementById('filter-row');
  row.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'filter-chip' + (activeFilter === 'all' ? ' active' : '');
  allBtn.dataset.cat = 'all';
  allBtn.textContent = 'All';
  row.appendChild(allBtn);

  const cats = getAllCategories();
  Object.keys(cats).forEach(key => {
    const c = cats[key];
    const btn = document.createElement('button');
    btn.className = 'filter-chip' + (activeFilter === key ? ' active' : '');
    btn.dataset.cat = key;
    btn.textContent = `${c.icon} ${c.label}`;
    row.appendChild(btn);
  });

  row.querySelectorAll('.filter-chip').forEach(pill => {
    pill.addEventListener('click', () => {
      row.querySelectorAll('.filter-chip').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeFilter = pill.dataset.cat;
      applyFilters();
    });
  });
}

function rebuildOwnerFilter() {
  const sel = document.getElementById('filter-owner');
  const current = sel.value;
  sel.innerHTML = '<option value="all">Everyone</option>';
  loadPeople().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
  sel.value = loadPeople().includes(current) ? current : 'all';
}

function matchesOwner(ev) { return ownerFilter === 'all' || getEventOwners(ev).includes(ownerFilter); }
function matchesSize(ev) { return sizeFilter === 'all' || (ev.size || 'M') === sizeFilter; }
function matchesCategory(ev) { return activeFilter === 'all' || ev.category === activeFilter || (activeFilter === 'INT' && ev.category === 'WED'); }

// ── SEARCH ────────────────────────────────────────────────────────────────────
function initSearch() {
  const input = document.getElementById('search-input');
  const field = input.closest('.search-field');
  const clearBtn = document.getElementById('search-clear');
  input.addEventListener('input', () => {
    searchQuery = input.value.trim().toLowerCase();
    field.classList.toggle('has-value', searchQuery.length > 0);
    applyFilters();
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    searchQuery = '';
    field.classList.remove('has-value');
    applyFilters();
    input.focus();
  });
}

function matchesSearch(ev) {
  if (!searchQuery) return true;
  const hay = `${ev.en1 || ''} ${ev.en2 || ''} ${ev.ar || ''}`.toLowerCase();
  return hay.includes(searchQuery);
}

// ── RENDERING ────────────────────────────────────────────────────────────────
function daysInMonth(m, y) { return new Date(y, m, 0).getDate(); }
function firstDow(m, y) { let d = new Date(y, m-1, 1).getDay(); return d === 0 ? 6 : d - 1; }

function eventsFor(year, month, day) {
  return EVENTS.filter(e => e.year === year && e.month === month && e.day === day);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function buildChip(ev) {
  const cats = getAllCategories();
  const meta = cats[ev.category] || { label: ev.category, icon: '•', color: '#8E8E93' };
  const div = document.createElement('div');
  div.className = 'event-chip';
  div.dataset.cat = ev.category;
  div.style.setProperty('--chip-color', meta.color);
  div.style.setProperty('--chip-bg', hexToTint(meta.color));
  const sizeLabel = SIZE_META[ev.size || 'M'];
  const owners = getEventOwners(ev);
  const ownerTags = owners.map(o => `<span class="chip-owner-tag">👤 ${escapeHtml(o)}</span>`).join('');
  div.innerHTML = `
    <span class="chip-en">${meta.icon} ${escapeHtml(ev.en1)}</span>
    ${ev.en2 ? `<span class="chip-sub">${escapeHtml(ev.en2)}</span>` : ''}
    ${ev.ar ? `<span class="chip-ar">${escapeHtml(ev.ar)}</span>` : ''}
    <span class="chip-meta-row">
      ${ownerTags}
      <span class="chip-size-tag">${sizeLabel}</span>
    </span>
    ${editMode ? '<span class="chip-edit-hint">✎</span>' : ''}
  `;
  div.classList.add('editable');
  if (editMode) {
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      openEventForm({ mode: 'edit', id: ev.id, year: ev.year, month: ev.month, day: ev.day, data: ev });
    });
  } else {
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      openDetailsModal(ev);
    });
  }
  if (!matchesSearch(ev) || !matchesOwner(ev) || !matchesSize(ev)) div.classList.add('hidden-filtered');
  return div;
}

// ── EVENT DETAILS (read-only view) ───────────────────────────────────────────
function openDetailsModal(ev) {
  const cats = getAllCategories();
  const meta = cats[ev.category] || { label: ev.category, icon: '•', color: '#8E8E93' };

  document.getElementById('details-icon').textContent = meta.icon;
  document.getElementById('details-icon').style.background = hexToTint(meta.color);
  document.getElementById('details-title').textContent = ev.en1;
  document.getElementById('details-cat').textContent = meta.label;
  document.getElementById('details-cat').style.color = meta.color;
  document.getElementById('details-date').textContent = `${MONTH_NAMES[ev.month-1]} ${ev.day}, ${ev.year}`;
  const owners = getEventOwners(ev);
  document.getElementById('details-owner').textContent = owners.length ? owners.join(', ') : 'Unassigned';
  document.getElementById('details-size').textContent = SIZE_META[ev.size || 'M'];

  const subRow = document.getElementById('details-sub-row');
  if (ev.en2) { subRow.style.display = 'flex'; document.getElementById('details-sub').textContent = ev.en2; }
  else subRow.style.display = 'none';

  const arRow = document.getElementById('details-ar-row');
  if (ev.ar) { arRow.style.display = 'flex'; document.getElementById('details-ar').textContent = ev.ar; }
  else arRow.style.display = 'none';

  const notesWrap = document.getElementById('details-notes-wrap');
  if (ev.notes) { notesWrap.style.display = 'block'; document.getElementById('details-notes').textContent = ev.notes; }
  else notesWrap.style.display = 'none';

  openSheet('details-modal');
}
function closeDetailsModal() { closeSheet('details-modal'); }

function hexToTint(hex) {
  const h = hex.replace('#','');
  const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},0.10)`;
}

function buildMonth(md) {
  const section = document.createElement('section');
  section.className = 'month-section';
  section.id = `month-${md.y}-${md.m}`;

  const hdr = document.createElement('div');
  hdr.className = 'month-header';
  hdr.innerHTML = `
    <div class="month-name">${MONTH_NAMES[md.m-1]} ${md.y}</div>
    <div class="month-meta">
      <span class="month-hijri">${md.hijri}</span>
      <span class="month-theme">${md.theme}</span>
    </div>`;
  section.appendChild(hdr);

  const list = document.createElement('div');
  list.className = 'day-list';

  const dim = daysInMonth(md.m, md.y);
  const fd = firstDow(md.m, md.y);
  let anyVisibleInMonth = false;

  for (let day = 1; day <= dim; day++) {
    const col = (fd + day - 1) % 7;
    const evs = eventsFor(md.y, md.m, day);
    const isOff = evs.some(e => e.category === 'OFF');
    const isFri = col === 4;
    const isWed = col === 2;

    const visibleEvs = evs
      .filter(matchesCategory)
      .filter(matchesOwner)
      .filter(matchesSize)
      .filter(matchesSearch);

    const showFajrPlaceholder = isFri && !isOff && evs.length === 0 && activeFilter === 'all' && ownerFilter === 'all' && sizeFilter === 'all' && !searchQuery;

    // In edit mode always show every day (so a day can be added to).
    // Otherwise only show days with something visible, or the Friday Fajr placeholder.
    if (!editMode && visibleEvs.length === 0 && !showFajrPlaceholder) continue;

    const row = document.createElement('div');
    row.className = 'day-row' + (isOff ? ' is-off' : '') + (isWed && !isOff ? ' is-wed' : '') + (isFri && !isOff ? ' is-fri' : '');

    const dateCol = document.createElement('div');
    dateCol.className = 'day-date-col';
    dateCol.innerHTML = `<span class="day-num">${day}</span><span class="day-name">${DAY_NAMES_SHORT[col]}</span>`;
    row.appendChild(dateCol);

    const contentCol = document.createElement('div');
    contentCol.className = 'day-content-col';

    evs.forEach(ev => {
      const chip = buildChip(ev);
      const passesFilter = matchesCategory(ev) && matchesOwner(ev) && matchesSize(ev);
      if (!passesFilter) chip.classList.add('hidden-filtered');
      contentCol.appendChild(chip);
    });

    if (showFajrPlaceholder) {
      const fajr = document.createElement('div');
      fajr.className = 'fajr-tag';
      fajr.textContent = '🕌 Fajr Prayer';
      contentCol.appendChild(fajr);
    }

    if (editMode) {
      const addBtn = document.createElement('button');
      addBtn.className = 'add-event-btn';
      addBtn.textContent = '+ Add event';
      addBtn.addEventListener('click', () => openEventForm({ mode: 'add', year: md.y, month: md.m, day }));
      contentCol.appendChild(addBtn);
    }

    row.appendChild(contentCol);
    list.appendChild(row);
    anyVisibleInMonth = true;
  }

  section.appendChild(list);
  section.dataset.hasContent = anyVisibleInMonth ? '1' : '0';
  if (!anyVisibleInMonth) section.style.display = 'none';
  return section;
}

function buildMonthScrubber() {
  const wrap = document.getElementById('month-scrubber');
  wrap.innerHTML = '';
  MONTH_DEFS.forEach(md => {
    const btn = document.createElement('button');
    btn.className = 'scrub-btn';
    btn.textContent = `${MONTH_SHORT[md.m-1]} ${String(md.y).slice(2)}`;
    btn.addEventListener('click', () => {
      const el = document.getElementById(`month-${md.y}-${md.m}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    wrap.appendChild(btn);
  });
}

function applyFilters() {
  renderAll();
}

function renderAll() {
  const cal = document.getElementById('calendar');
  cal.innerHTML = '';
  let anyContent = false;
  MONTH_DEFS.forEach(md => {
    const section = buildMonth(md);
    if (section.dataset.hasContent === '1') anyContent = true;
    cal.appendChild(section);
  });
  document.getElementById('empty-state').style.display = anyContent ? 'none' : 'block';
  cal.style.display = anyContent ? 'block' : 'none';
}

// ── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  rebuildFilterChips();
  rebuildOwnerFilter();
  buildMonthScrubber();
  initSearch();
  loadEvents();

  document.getElementById('edit-toggle-btn').addEventListener('click', toggleEditMode);
  document.getElementById('passcode-submit').addEventListener('click', tryPasscode);
  document.getElementById('passcode-cancel').addEventListener('click', closePasscodeModal);
  document.getElementById('passcode-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryPasscode(); });

  document.getElementById('event-cancel-btn').addEventListener('click', closeEventForm);
  document.getElementById('event-save-btn').addEventListener('click', submitEventForm);
  document.getElementById('event-delete-btn').addEventListener('click', deleteFromForm);

  document.getElementById('fab-manage-btn').addEventListener('click', openManageModal);
  document.getElementById('manage-close-btn').addEventListener('click', closeManageModal);
  document.getElementById('add-cal-btn').addEventListener('click', addCustomCategory);
  document.getElementById('add-person-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-person-name');
    const name = input.value.trim();
    if (!name) { showToast('Enter a name.', true); return; }
    const ok = await addPerson(name);
    if (!ok) { showToast('That person already exists.', true); return; }
    input.value = '';
    renderPeopleList();
    rebuildOwnerFilter();
    showToast('Person added ✓');
  });

  document.querySelectorAll('.manage-tab').forEach(tab => {
    tab.addEventListener('click', () => switchManageTab(tab.dataset.tab));
  });

  document.getElementById('edit-cal-save-btn').addEventListener('click', saveEditedCalendar);
  document.getElementById('edit-cal-cancel-btn').addEventListener('click', closeEditCalendarModal);
  document.getElementById('edit-cal-modal').addEventListener('click', (e) => { if (e.target.id === 'edit-cal-modal') closeEditCalendarModal(); });

  document.getElementById('filter-owner').addEventListener('change', (e) => { ownerFilter = e.target.value; applyFilters(); });
  document.getElementById('filter-size').addEventListener('change', (e) => { sizeFilter = e.target.value; applyFilters(); });

  document.getElementById('details-close-btn').addEventListener('click', closeDetailsModal);
  document.getElementById('details-modal').addEventListener('click', (e) => { if (e.target.id === 'details-modal') closeDetailsModal(); });

  // Close sheets on backdrop click
  document.getElementById('passcode-modal').addEventListener('click', (e) => { if (e.target.id === 'passcode-modal') closePasscodeModal(); });
  document.getElementById('event-modal').addEventListener('click', (e) => { if (e.target.id === 'event-modal') closeEventForm(); });
  document.getElementById('manage-modal').addEventListener('click', (e) => { if (e.target.id === 'manage-modal') closeManageModal(); });
});
