const CONVERTER_TABS_KEY = 'eccho_converter_tab_ids';
const SESSION_DATA_KEY = 'eccho_converter_session_v1';

async function getTrackedTabIds() {
  const result = await chrome.storage.session.get({ [CONVERTER_TABS_KEY]: [] });
  return Array.isArray(result[CONVERTER_TABS_KEY])
    ? result[CONVERTER_TABS_KEY]
    : [];
}

async function setTrackedTabIds(tabIds) {
  await chrome.storage.session.set({ [CONVERTER_TABS_KEY]: tabIds });
}

chrome.action.onClicked.addListener(async () => {
  const converterUrl = chrome.runtime.getURL('index.html');
  const trackedIds = await getTrackedTabIds();

  for (const tabId of trackedIds) {
    try {
      const existing = await chrome.tabs.get(tabId);
      if (existing?.id !== undefined) {
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId !== undefined) {
          await chrome.windows.update(existing.windowId, { focused: true });
        }
        return;
      }
    } catch {
      // Tab no longer exists
    }
  }

  const created = await chrome.tabs.create({ url: converterUrl });
  if (created.id !== undefined) {
    await setTrackedTabIds([created.id]);
  }
});

chrome.tabs.onRemoved.addListener(async (closedTabId) => {
  const trackedIds = await getTrackedTabIds();
  if (!trackedIds.includes(closedTabId)) {
    return;
  }

  const remaining = trackedIds.filter((id) => id !== closedTabId);
  if (remaining.length === 0) {
    await chrome.storage.session.remove([CONVERTER_TABS_KEY, SESSION_DATA_KEY]);
  } else {
    await setTrackedTabIds(remaining);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'REGISTER_CONVERTER_TAB') {
    (async () => {
      const senderTabId = sender.tab?.id;
      if (senderTabId !== undefined) {
        const current = await getTrackedTabIds();
        if (!current.includes(senderTabId)) {
          await setTrackedTabIds([...current, senderTabId]);
        }
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === 'CLEAR_EXTENSION_SESSION') {
    (async () => {
      await chrome.storage.session.remove(SESSION_DATA_KEY);
      sendResponse({ ok: true });
    })();
    return true;
  }

  return false;
});

