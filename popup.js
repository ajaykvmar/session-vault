// ===== Session Vault - Popup UI =====

const BG = chrome.runtime;

// ─── Send message helper ────────────────────────────────────────────────
function bg(msg) {
  return new Promise((resolve, reject) => {
    BG.sendMessage(msg, r => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (!r || !r.ok) return reject(new Error(r?.error || 'Request failed'));
      resolve(r);
    });
  });
}

// ─── Toast ──────────────────────────────────────────────────────────────
let toastTimer;

function toast(msg, dur = 2000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

// ─── Color Picker ───────────────────────────────────────────────────────
const GROUP_COLORS = ['blue','red','yellow','green','purple','orange','cyan','grey','pink'];
let selectedColor = 'blue';

function initColorPicker() {
  const container = document.getElementById('colorPicker');
  container.innerHTML = '';
  GROUP_COLORS.forEach(c => {
    const btn = document.createElement('button');
    btn.style.background = colorToHex(c);
    btn.dataset.color = c;
    if (c === 'blue') btn.classList.add('selected');
    btn.addEventListener('click', () => {
      container.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedColor = c;
    });
    container.appendChild(btn);
  });
}

function colorToHex(c) {
  const map = {
    blue: '#5e9eff', red: '#ff453a', yellow: '#ffd60a',
    green: '#30d158', purple: '#bf5af2', orange: '#ff9f0a',
    cyan: '#64d2ff', grey: '#8e8e93', pink: '#ff375f'
  };
  return map[c] || map.blue;
}

// ─── Render Groups ──────────────────────────────────────────────────────
async function renderGroups() {
  const { groups } = await bg({ action: 'listGroups' });
  const list = document.getElementById('groupsList');
  const empty = document.getElementById('groupsEmpty');
  const count = document.getElementById('groupsCount');

  count.textContent = groups.length;
  list.innerHTML = '';

  if (!groups.length) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  // Get current tab for "add to group" feature
  let currentTab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length) currentTab = tabs[0];
  } catch (_) {}

  groups.forEach(g => {
    const item = document.createElement('div');
    item.className = 'group-item';

    const row = document.createElement('div');
    row.className = 'group-row';

    const info = document.createElement('div');
    info.className = 'group-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'group-name';
    const dot = document.createElement('span');
    dot.className = 'group-color-dot';
    dot.style.background = colorToHex(g.color || 'grey');
    nameRow.appendChild(dot);
    nameRow.append(document.createTextNode(g.name));

    const meta = document.createElement('div');
    meta.className = 'group-meta';
    meta.textContent = `${g.tabs.length} tab${g.tabs.length !== 1 ? 's' : ''}`;

    info.appendChild(nameRow);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'group-actions';

    // Add to group button
    const addBtn = document.createElement('button');
    addBtn.className = 'icon-btn';
    addBtn.title = currentTab ? `Add "${currentTab.title}" to this group` : 'No active tab';
    addBtn.textContent = '+';
    addBtn.disabled = !currentTab;
    addBtn.style.opacity = currentTab ? '' : '.3';
    addBtn.addEventListener('click', async () => {
      if (!currentTab) return;
      try {
        await bg({ action: 'addToGroup', groupId: g.id, url: currentTab.url, title: currentTab.title });
        toast(`Added to "${g.name}"`);
        renderGroups();
      } catch (e) {
        toast(`Error: ${e.message}`, 3000);
      }
    });

    // Open group button
    const openBtn = document.createElement('button');
    openBtn.className = 'icon-btn';
    openBtn.title = 'Open all tabs in this group';
    openBtn.textContent = '▶';
    openBtn.addEventListener('click', async () => {
      try {
        await bg({ action: 'openGroup', groupId: g.id });
        toast(`Opened "${g.name}"`);
      } catch (e) {
        toast(`Error: ${e.message}`, 3000);
      }
    });

    // Delete group
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn danger';
    delBtn.title = 'Delete group';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', async () => {
      try {
        await bg({ action: 'deleteGroup', groupId: g.id });
        renderGroups();
      } catch (e) {
        toast(`Error: ${e.message}`, 3000);
      }
    });

    actions.appendChild(addBtn);
    actions.appendChild(openBtn);
    actions.appendChild(delBtn);

    row.appendChild(info);
    row.appendChild(actions);
    item.appendChild(row);
    list.appendChild(item);
  });
}

// ─── Save Current Tab ───────────────────────────────────────────────────
let currentTabUrl = '';
let currentTabTitle = '';

async function populateGroupSelect() {
  const select = document.getElementById('groupSelect');
  const toGroupBtn = document.getElementById('saveToGroupBtn');

  try {
    // Get current tab info
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length && tabs[0].url) {
      currentTabUrl = tabs[0].url;
      currentTabTitle = tabs[0].title || tabs[0].url;
    } else {
      currentTabUrl = '';
      currentTabTitle = '';
    }

    // Fetch groups for dropdown
    const { groups } = await bg({ action: 'listGroups' });
    const selected = select.value;
    select.innerHTML = '<option value="">Select…</option>';

    groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `${g.name} (${g.tabs.length})`;
      select.appendChild(opt);
    });

    if (selected && groups.some(g => g.id === selected)) {
      select.value = selected;
    }

    toGroupBtn.disabled = !select.value || !currentTabUrl;
  } catch (e) {
    console.warn('Failed to populate groups:', e);
  }
}

function setupTabSaver() {
  const saveBtn = document.getElementById('saveTabBtn');
  const select = document.getElementById('groupSelect');
  const toGroupBtn = document.getElementById('saveToGroupBtn');

  // Standalone Save Tab
  saveBtn.addEventListener('click', async () => {
    if (!currentTabUrl) {
      toast('No active tab to save', 1500);
      return;
    }
    try {
      await bg({ action: 'saveTab', url: currentTabUrl, title: currentTabTitle });
      toast('Tab saved');
      renderSavedTabs();
    } catch (e) {
      toast(`Error: ${e.message}`, 3000);
    }
  });

  // Group save
  select.addEventListener('change', () => {
    toGroupBtn.disabled = !select.value || !currentTabUrl;
  });

  toGroupBtn.addEventListener('click', async () => {
    const groupId = select.value;
    if (!groupId || !currentTabUrl) {
      toast('Select a group first', 1500);
      return;
    }
    try {
      const { group } = await bg({
        action: 'addToGroup', groupId,
        url: currentTabUrl, title: currentTabTitle
      });
      toast(`Saved to "${group.name}"`);
      populateGroupSelect();
      renderGroups();
    } catch (e) {
      toast(`Error: ${e.message}`, 3000);
    }
  });
}

// ─── Render Saved Tabs ──────────────────────────────────────────────────

function fmtTimeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

async function renderSavedTabs() {
  const { tabs } = await bg({ action: 'listSavedTabs' });
  const list = document.getElementById('savedTabsList');
  const empty = document.getElementById('savedTabsEmpty');
  const count = document.getElementById('savedTabsCount');

  count.textContent = tabs.length;
  list.innerHTML = '';

  if (!tabs.length) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tabs.forEach(t => {
    const item = document.createElement('div');
    item.className = 'session-item'; // reuse session card style

    const row = document.createElement('div');
    row.className = 'session-row';

    const info = document.createElement('div');
    info.className = 'session-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'session-name';
    nameEl.textContent = t.title || t.url;
    nameEl.title = t.url;

    const meta = document.createElement('div');
    meta.className = 'session-meta';
    meta.textContent = fmtTimeAgo(t.savedAt);

    info.appendChild(nameEl);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'session-actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'icon-btn';
    openBtn.title = 'Open tab';
    openBtn.textContent = '▶';
    openBtn.addEventListener('click', async () => {
      try {
        await bg({ action: 'openSavedTab', tabId: t.id });
        window.close(); // close popup after opening
      } catch (e) {
        toast(`Error: ${e.message}`, 3000);
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn danger';
    delBtn.title = 'Remove';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', async () => {
      try {
        await bg({ action: 'deleteSavedTab', tabId: t.id });
        renderSavedTabs();
      } catch (e) {
        toast(`Error: ${e.message}`, 3000);
      }
    });

    actions.appendChild(openBtn);
    actions.appendChild(delBtn);

    row.appendChild(info);
    row.appendChild(actions);
    item.appendChild(row);
    list.appendChild(item);
  });
}

// ─── Render Sessions ────────────────────────────────────────────────────
function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec'];
  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  const dateStr = `${months[d.getMonth()]} ${d.getDate()}`;

  // Same day?
  if (d.toDateString() === now.toDateString()) {
    return `Today at ${h12}:${m} ${ampm}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${h12}:${m} ${ampm}`;
  }
  return `${dateStr} at ${h12}:${m} ${ampm}`;
}

async function renderSessions() {
  const { sessions } = await bg({ action: 'listSessions' });
  const list = document.getElementById('sessionsList');
  const empty = document.getElementById('sessionsEmpty');
  const count = document.getElementById('sessionsCount');

  count.textContent = sessions.length;
  list.innerHTML = '';

  if (!sessions.length) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  // Group by date
  const groups = {};
  sessions.forEach(s => {
    const d = new Date(s.createdAt);
    const now = new Date();
    const key = d.toDateString() === now.toDateString() ? 'Today'
      : (new Date(now.setDate(now.getDate()-1)).toDateString() === d.toDateString() ? 'Yesterday'
        : d.toDateString());
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  });

  const sections = ['Today', 'Yesterday', ...Object.keys(groups).filter(k => k !== 'Today' && k !== 'Yesterday').sort().reverse()];

  sections.forEach(sectionKey => {
    if (!groups[sectionKey]) return;
    // Section label
    const label = document.createElement('div');
    label.style.cssText = 'font-size:11px;color:var(--text2);padding:6px 0 2px;font-weight:500;';
    label.textContent = sectionKey;
    list.appendChild(label);

    groups[sectionKey].forEach(s => {
      const item = document.createElement('div');
      item.className = 'session-item';

      const row = document.createElement('div');
      row.className = 'session-row';

      const info = document.createElement('div');
      info.className = 'session-info';

      const nameEl = document.createElement('div');
      nameEl.className = 'session-name';
      nameEl.textContent = s.name;

      const meta = document.createElement('div');
      meta.className = 'session-meta';
      meta.textContent = `${s.windowCount} window${s.windowCount !== 1 ? 's' : ''} · ${s.tabCount} tab${s.tabCount !== 1 ? 's' : ''} · ${formatDate(s.createdAt)}`;

      info.appendChild(nameEl);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'session-actions';

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'icon-btn';
      restoreBtn.title = 'Restore session';
      restoreBtn.textContent = '▶';
      restoreBtn.addEventListener('click', async () => {
        try {
          await bg({ action: 'restore', sessionId: s.id });
          toast('Session restored');
        } catch (e) {
          toast(`Error: ${e.message}`, 3000);
        }
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn danger';
      delBtn.title = 'Delete session';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', async () => {
        try {
          await bg({ action: 'deleteSession', sessionId: s.id });
          renderSessions();
        } catch (e) {
          toast(`Error: ${e.message}`, 3000);
        }
      });

      actions.appendChild(restoreBtn);
      actions.appendChild(delBtn);

      row.appendChild(info);
      row.appendChild(actions);
      item.appendChild(row);
      list.appendChild(item);
    });
  });
}

// ─── Stats ──────────────────────────────────────────────────────────────
async function renderStats() {
  try {
    const { stats } = await bg({ action: 'stats' });
    document.getElementById('statsBadge').textContent =
      `${stats.tabCount} tab${stats.tabCount !== 1 ? 's' : ''} · ${stats.windowCount} win${stats.windowCount !== 1 ? 's' : ''}`;
  } catch (_) {
    document.getElementById('statsBadge').textContent = '—';
  }
}

// ─── Save Actions ───────────────────────────────────────────────────────
// Selective save via group selection overlay

let overlayAndClose = false;

async function openGroupSelectOverlay(andClose) {
  overlayAndClose = andClose;
  const overlay = document.getElementById('groupSelectOverlay');
  const list = document.getElementById('overlayGroupList');
  const empty = document.getElementById('overlayEmpty');
  const ungroupedRow = document.getElementById('overlayUngroupedRow');
  const saveBtn = document.getElementById('overlaySaveBtn');
  const saveCloseBtn = document.getElementById('overlaySaveCloseBtn');

  // Show the right button for the mode
  if (andClose) {
    saveCloseBtn.style.display = '';
    saveBtn.style.display = 'none';
    saveCloseBtn.textContent = '💾✕ Save Selected & Close';
  } else {
    saveBtn.style.display = '';
    saveCloseBtn.style.display = 'none';
    saveBtn.textContent = '💾 Save Selected';
  }

  try {
    const { groups, ungrouped } = await bg({ action: 'listCurrentGroups' });

    list.innerHTML = '';

    if (!groups.length && !ungrouped.length) {
      empty.style.display = '';
      ungroupedRow.style.display = 'none';
      saveBtn.disabled = true;
      saveCloseBtn.disabled = true;
    } else {
      empty.style.display = 'none';

      // Show ungrouped row if there are ungrouped tabs
      if (ungrouped.length > 0) {
        ungroupedRow.style.display = 'flex';
        document.querySelector('#overlayUngroupedRow span').textContent =
          `Include ungrouped tabs (${ungrouped.length} tab${ungrouped.length !== 1 ? 's' : ''})`;
      } else {
        ungroupedRow.style.display = 'none';
      }

      // Render groups with checkboxes
      groups.forEach(g => {
        const item = document.createElement('div');
        item.className = 'sel-group-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.dataset.groupId = g.id;

        const dot = document.createElement('span');
        dot.className = 'sel-group-dot';
        dot.style.background = colorToHex(g.color || 'grey');

        const label = document.createElement('span');
        label.className = 'sel-group-label';
        label.textContent = g.title;

        const count = document.createElement('span');
        count.className = 'sel-group-count';
        count.textContent = `${g.tabs.length} tab${g.tabs.length !== 1 ? 's' : ''}`;

        item.appendChild(cb);
        item.appendChild(dot);
        item.appendChild(label);
        item.appendChild(count);
        list.appendChild(item);
      });

      saveBtn.disabled = false;
      saveCloseBtn.disabled = false;
    }
  } catch (e) {
    list.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
    saveBtn.disabled = true;
    saveCloseBtn.disabled = true;
  }

  overlay.classList.add('open');
}

function getSelectedGroupIds() {
  const ids = [];
  document.querySelectorAll('#overlayGroupList input[type="checkbox"]').forEach(cb => {
    if (cb.checked) ids.push(cb.dataset.groupId);
  });
  return ids;
}

async function handleSelectiveSave(andClose) {
  const groupIds = getSelectedGroupIds();
  const includeUngrouped = document.getElementById('overlayIncludeUngrouped').checked;
  const action = andClose ? 'saveSelectedAndClose' : 'saveSelected';
  const overlay = document.getElementById('groupSelectOverlay');
  // The active button depends on mode — use it for loading state
  const activeBtn = andClose
    ? document.getElementById('overlaySaveCloseBtn')
    : document.getElementById('overlaySaveBtn');

  if (!groupIds.length && !includeUngrouped) {
    toast('Select at least one group or enable ungrouped tabs', 2000);
    return;
  }

  activeBtn.disabled = true;
  const origText = activeBtn.textContent;
  activeBtn.textContent = '⏳ Saving…';

  try {
    const r = await bg({ action, groupsToInclude: groupIds, includeUngrouped });
    overlay.classList.remove('open');

    const parts = [];
    if (r.groups > 0) parts.push(`${r.groupTabs} tab${r.groupTabs !== 1 ? 's' : ''} in ${r.groups} group${r.groups !== 1 ? 's' : ''}`);
    if (r.ungrouped > 0) parts.push(`${r.ungrouped} ungrouped tab${r.ungrouped !== 1 ? 's' : ''}`);
    toast(`Saved: ${parts.join(', ')}`, 2500);

    renderGroups();
    renderSavedTabs();
    renderStats();

    // Optionally discard unselected tabs after saving
    if (document.getElementById('overlayDiscardUnselected').checked) {
      const { count } = await bg({ action: 'discardUnselected', groupsToKeep: groupIds, discardUngrouped: !includeUngrouped });
      if (count > 0) toast(`Saved + discarded ${count} tab${count !== 1 ? 's' : ''}`, 2500);
    }
  } catch (e) {
    toast(`Error: ${e.message}`, 3000);
    activeBtn.textContent = origText;
    activeBtn.disabled = false;
  }
}

// ─── Old handleSave kept for backward compat (not used by buttons anymore) ──

// ─── Standalone Discard ─────────────────────────────────────────────────
async function handleDiscardOnly() {
  const groupIds = getSelectedGroupIds();
  const discardUngrouped = document.getElementById('overlayIncludeUngrouped').checked;
  const overlay = document.getElementById('groupSelectOverlay');

  if (!groupIds.length && !discardUngrouped) {
    toast('Select at least one group to keep, or enable ungrouped tabs', 2000);
    return;
  }

  const btn = document.getElementById('overlayDiscardBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Discarding…';

  try {
    const { count } = await bg({ action: 'discardUnselected', groupsToKeep: groupIds, discardUngrouped });
    overlay.classList.remove('open');
    if (count > 0) {
      toast(`Discarded ${count} tab${count !== 1 ? 's' : ''} — RAM freed`, 2500);
    } else {
      toast('No tabs to discard (all already discarded or kept)', 2000);
    }
    renderStats();
  } catch (e) {
    toast(`Error: ${e.message}`, 3000);
    btn.disabled = false;
    btn.textContent = '🗑 Discard Others (save nothing, just free RAM)';
  }
}

// ─── New Group Form ─────────────────────────────────────────────────────
function setupNewGroupForm() {
  const toggleBtn = document.getElementById('newGroupBtn');
  const form = document.getElementById('newGroupForm');
  const input = document.getElementById('groupNameInput');
  const createBtn = document.getElementById('createGroupBtn');

  toggleBtn.addEventListener('click', () => {
    form.classList.toggle('open');
    if (form.classList.contains('open')) input.focus();
  });

  createBtn.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) { toast('Enter a group name', 1500); return; }
    try {
      await bg({ action: 'createGroup', name, color: selectedColor });
      input.value = '';
      form.classList.remove('open');
      toast(`Created "${name}"`);
      renderGroups();
    } catch (e) {
      toast(`Error: ${e.message}`, 3000);
    }
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') createBtn.click();
    if (e.key === 'Escape') form.classList.remove('open');
  });
}

// ─── Section Collapse ──────────────────────────────────────────────────
function setupSections() {
  ['savedTabs', 'groups', 'sessions'].forEach(key => {
    const toggle = document.getElementById(`${key}Toggle`);
    const body = document.getElementById(`${key}Body`);
    const arrow = document.getElementById(`${key}Arrow`);
    let open = key === 'savedTabs'; // saved tabs open by default

    toggle.addEventListener('click', () => {
      open = !open;
      body.classList.toggle('hidden', !open);
      arrow.classList.toggle('open', open);
    });
  });
}

// ─── Init ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initColorPicker();
  setupSections();
  setupNewGroupForm();
  setupTabSaver();

  // Save buttons open the group selection overlay
  document.getElementById('saveBtn').addEventListener('click', () => openGroupSelectOverlay(false));
  document.getElementById('saveCloseBtn').addEventListener('click', () => openGroupSelectOverlay(true));

  // Overlay buttons
  document.getElementById('overlaySaveBtn').addEventListener('click', () => handleSelectiveSave(false));
  document.getElementById('overlaySaveCloseBtn').addEventListener('click', () => handleSelectiveSave(true));
  document.getElementById('overlayCancelBtn').addEventListener('click', () => {
    document.getElementById('groupSelectOverlay').classList.remove('open');
  });
  document.getElementById('overlayCloseBtn').addEventListener('click', () => {
    document.getElementById('groupSelectOverlay').classList.remove('open');
  });
  // Close overlay on backdrop click
  document.getElementById('groupSelectOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('groupSelectOverlay').classList.remove('open');
    }
  });

  // Standalone discard button
  document.getElementById('overlayDiscardBtn').addEventListener('click', handleDiscardOnly);

  await Promise.all([
    renderStats(),
    populateGroupSelect(),
    renderSavedTabs(),
    renderGroups(),
    renderSessions()
  ]);
});
