// ===== Session Vault - Service Worker =====
// Session save/restore + persistent named groups

const SESSIONS_KEY = 'sv_sessions';
const GROUPS_KEY   = 'sv_groups';
const SAVED_TABS_KEY = 'sv_savedTabs';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SESSIONS (full window snapshots)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function saveSession(name) {
  const wins = await chrome.windows.getAll({ populate: true });
  const normal = wins.filter(w => w.type === 'normal');
  if (!normal.length) throw new Error('No normal windows to save');

  const allGroups = await chrome.tabGroups.query({});

  const session = {
    id: crypto.randomUUID(),
    name: name || autoName(),
    createdAt: Date.now(),
    windows: normal.map(win => {
      const winGroups = allGroups.filter(g => g.windowId === win.id);
      return {
        state: win.state,
        top: win.top, left: win.left,
        width: win.width, height: win.height,
        groups: winGroups.map(g => ({
          title: g.title, color: g.color, collapsed: g.collapsed
        })),
        tabs: win.tabs.map(t => ({
          url: t.url, title: t.title, pinned: t.pinned || false,
          active: t.active || false, index: t.index,
          groupIdx: t.groupId > 0
            ? winGroups.findIndex(g => g.id === t.groupId)
            : -1
        }))
      };
    })
  };

  session.tabCount = session.windows.reduce((s, w) => s + w.tabs.length, 0);
  session.windowCount = session.windows.length;

  const data = await chrome.storage.local.get(SESSIONS_KEY);
  const list = data[SESSIONS_KEY] || [];
  list.unshift(session);
  await chrome.storage.local.set({ [SESSIONS_KEY]: list });
  return session;
}

async function restoreSession(id) {
  const data = await chrome.storage.local.get(SESSIONS_KEY);
  const list = data[SESSIONS_KEY] || [];
  const session = list.find(s => s.id === id);
  if (!session) throw new Error('Session not found');

  for (const winData of session.windows) {
    const params = { state: winData.state || 'normal' };
    if (winData.state === 'normal') {
      if (winData.left   != null) params.left   = winData.left;
      if (winData.top    != null) params.top    = winData.top;
      if (winData.width  != null) params.width  = winData.width;
      if (winData.height != null) params.height = winData.height;
    }
    const win = await chrome.windows.create(params);

    const createdIds = [];
    const groupMap = {}; // saved groupIdx -> tabIds[]

    for (const t of winData.tabs) {
      if (t.url && (t.url.startsWith('chrome://') ||
          t.url.startsWith('chrome-extension://') ||
          t.url.startsWith('about:'))) continue;
      try {
        const tab = await chrome.tabs.create({
          windowId: win.id, url: t.url || 'about:blank',
          pinned: t.pinned, active: false
        });
        createdIds.push(tab.id);
        if (t.groupIdx >= 0 && t.groupIdx < winData.groups.length) {
          if (!groupMap[t.groupIdx]) groupMap[t.groupIdx] = [];
          groupMap[t.groupIdx].push(tab.id);
        }
      } catch (e) {
        console.warn('Failed to restore tab:', t.url, e);
      }
    }

    // Remove default new tab
    const tabs = await chrome.tabs.query({ windowId: win.id });
    const def = tabs.find(t =>
      t.url === 'chrome://newtab/' || t.url === 'about:blank'
    );
    if (def && createdIds.length) {
      try { await chrome.tabs.remove(def.id); } catch (_) {}
    }

    // Restore groups
    for (const [gIdxStr, tabIds] of Object.entries(groupMap)) {
      const gIdx = parseInt(gIdxStr);
      const sg = winData.groups[gIdx];
      if (!sg || !tabIds.length) continue;
      try {
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, {
          title: sg.title || '', color: sg.color || 'grey',
          collapsed: sg.collapsed || false
        });
      } catch (e) {
        console.warn('Failed to restore group:', e);
      }
    }
  }
}

async function closeAllWindows() {
  const wins = await chrome.windows.getAll();
  for (const w of wins.filter(w => w.type === 'normal')) {
    try { await chrome.windows.remove(w.id); } catch (_) {}
  }
}

async function deleteSession(id) {
  const data = await chrome.storage.local.get(SESSIONS_KEY);
  const list = data[SESSIONS_KEY] || [];
  await chrome.storage.local.set({
    [SESSIONS_KEY]: list.filter(s => s.id !== id)
  });
}

async function clearAllSessions() {
  await chrome.storage.local.set({ [SESSIONS_KEY]: [] });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PERSISTENT NAMED GROUPS  (add tabs while browsing)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'purple',
                       'orange', 'cyan', 'grey', 'pink'];

async function createGroup(name, color) {
  if (!name || !name.trim()) throw new Error('Group name required');
  const data = await chrome.storage.local.get(GROUPS_KEY);
  const groups = data[GROUPS_KEY] || [];
  const g = {
    id: crypto.randomUUID(),
    name: name.trim(),
    color: color || 'blue',
    createdAt: Date.now(),
    tabs: []
  };
  groups.unshift(g);
  await chrome.storage.local.set({ [GROUPS_KEY]: groups });
  return g;
}

async function addToGroup(groupId, url, title) {
  if (!url) throw new Error('No URL to add');
  const data = await chrome.storage.local.get(GROUPS_KEY);
  const groups = data[GROUPS_KEY] || [];
  const g = groups.find(x => x.id === groupId);
  if (!g) throw new Error('Group not found');
  // Avoid dupes
  if (!g.tabs.some(t => t.url === url)) {
    g.tabs.push({ url, title: title || url, addedAt: Date.now() });
  }
  await chrome.storage.local.set({ [GROUPS_KEY]: groups });
  return g;
}

async function removeFromGroup(groupId, url) {
  const data = await chrome.storage.local.get(GROUPS_KEY);
  const groups = data[GROUPS_KEY] || [];
  const g = groups.find(x => x.id === groupId);
  if (!g) throw new Error('Group not found');
  g.tabs = g.tabs.filter(t => t.url !== url);
  await chrome.storage.local.set({ [GROUPS_KEY]: groups });
  return g;
}

async function openGroup(groupId) {
  const data = await chrome.storage.local.get(GROUPS_KEY);
  const groups = data[GROUPS_KEY] || [];
  const g = groups.find(x => x.id === groupId);
  if (!g) throw new Error('Group not found');
  if (!g.tabs.length) throw new Error('Group is empty');

  const win = await chrome.windows.create({ state: 'normal' });
  const createdIds = [];
  for (const t of g.tabs) {
    try {
      const tab = await chrome.tabs.create({
        windowId: win.id, url: t.url, active: false
      });
      createdIds.push(tab.id);
    } catch (e) {
      console.warn('Failed to open tab:', t.url, e);
    }
  }
  // Group them
  if (createdIds.length > 1) {
    try {
      const groupId = await chrome.tabs.group({ tabIds: createdIds });
      await chrome.tabGroups.update(groupId, {
        title: g.name, color: g.color || 'blue'
      });
    } catch (e) {
      console.warn('Failed to group tabs:', e);
    }
  }
  // Remove default new tab
  const tabs = await chrome.tabs.query({ windowId: win.id });
  const def = tabs.find(t =>
    t.url === 'chrome://newtab/' || t.url === 'about:blank'
  );
  if (def) try { await chrome.tabs.remove(def.id); } catch (_) {}
}

async function deleteGroup(id) {
  const data = await chrome.storage.local.get(GROUPS_KEY);
  const groups = data[GROUPS_KEY] || [];
  await chrome.storage.local.set({
    [GROUPS_KEY]: groups.filter(g => g.id !== id)
  });
}

async function listGroups() {
  const data = await chrome.storage.local.get(GROUPS_KEY);
  return data[GROUPS_KEY] || [];
}

async function renameGroup(id, name) {
  if (!name || !name.trim()) throw new Error('Name required');
  const data = await chrome.storage.local.get(GROUPS_KEY);
  const groups = data[GROUPS_KEY] || [];
  const g = groups.find(x => x.id === id);
  if (!g) throw new Error('Group not found');
  g.name = name.trim();
  await chrome.storage.local.set({ [GROUPS_KEY]: groups });
  return g;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SAVED TABS  (standalone — reading-list style)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function saveTab(url, title) {
  if (!url) throw new Error('No URL to save');
  const data = await chrome.storage.local.get(SAVED_TABS_KEY);
  const tabs = data[SAVED_TABS_KEY] || [];
  if (!tabs.some(t => t.url === url)) {
    tabs.unshift({ id: crypto.randomUUID(), url, title: title || url, savedAt: Date.now() });
  }
  await chrome.storage.local.set({ [SAVED_TABS_KEY]: tabs });
  return tabs[0];
}

async function deleteSavedTab(id) {
  const data = await chrome.storage.local.get(SAVED_TABS_KEY);
  const tabs = data[SAVED_TABS_KEY] || [];
  await chrome.storage.local.set({
    [SAVED_TABS_KEY]: tabs.filter(t => t.id !== id)
  });
}

async function openSavedTab(id) {
  const data = await chrome.storage.local.get(SAVED_TABS_KEY);
  const tabs = data[SAVED_TABS_KEY] || [];
  const tab = tabs.find(t => t.id === id);
  if (!tab) throw new Error('Saved tab not found');
  await chrome.tabs.create({ url: tab.url, active: true });
}

async function listSavedTabs() {
  const data = await chrome.storage.local.get(SAVED_TABS_KEY);
  return data[SAVED_TABS_KEY] || [];
}

async function clearAllSavedTabs() {
  await chrome.storage.local.set({ [SAVED_TABS_KEY]: [] });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CURRENT STATS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function currentStats() {
  const wins = await chrome.windows.getAll({ populate: true });
  const nw = wins.filter(w => w.type === 'normal');
  const tc = nw.reduce((s, w) => s + (w.tabs ? w.tabs.length : 0), 0);
  return { windowCount: nw.length, tabCount: tc };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MESSAGE ROUTER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  switch (req.action) {

    // Sessions
    case 'save':
      saveSession(req.name)
        .then(s => sendResponse({ ok: true, session: s }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'saveAndClose':
      saveSession(req.name)
        .then(async s => { await closeAllWindows(); return s; })
        .then(s => sendResponse({ ok: true, session: s }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'restore':
      restoreSession(req.sessionId)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'deleteSession':
      deleteSession(req.sessionId)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'clearAllSessions':
      clearAllSessions()
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'listSessions':
      chrome.storage.local.get(SESSIONS_KEY)
        .then(d => sendResponse({ ok: true, sessions: d[SESSIONS_KEY] || [] }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    // Groups
    case 'createGroup':
      createGroup(req.name, req.color)
        .then(g => sendResponse({ ok: true, group: g }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'addToGroup':
      addToGroup(req.groupId, req.url, req.title)
        .then(g => sendResponse({ ok: true, group: g }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'removeFromGroup':
      removeFromGroup(req.groupId, req.url)
        .then(g => sendResponse({ ok: true, group: g }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'openGroup':
      openGroup(req.groupId)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'deleteGroup':
      deleteGroup(req.groupId)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'listGroups':
      listGroups()
        .then(groups => sendResponse({ ok: true, groups }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'renameGroup':
      renameGroup(req.groupId, req.name)
        .then(g => sendResponse({ ok: true, group: g }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    // Saved Tabs
    case 'saveTab':
      saveTab(req.url, req.title)
        .then(t => sendResponse({ ok: true, tab: t }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'deleteSavedTab':
      deleteSavedTab(req.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'openSavedTab':
      openSavedTab(req.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'listSavedTabs':
      listSavedTabs()
        .then(tabs => sendResponse({ ok: true, tabs }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'clearAllSavedTabs':
      clearAllSavedTabs()
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    // Stats
    case 'stats':
      currentStats()
        .then(s => sendResponse({ ok: true, stats: s }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    default:
      sendResponse({ ok: false, error: `Unknown action: ${req.action}` });
      return false;
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────

function autoName() {
  const d = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec'];
  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${months[d.getMonth()]} ${d.getDate()}, ${h12}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}
