// Background service worker: context menu + API calls

const DEFAULT_API_BASE = "http://localhost:8000";

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-to-mindcard",
    title: "保存到 MindCard",
    contexts: ["selection"],
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "save-to-mindcard") return;

  // Get selection from content script
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "getSelection" });
    if (response && response.text) {
      // Store selection data and open popup
      await chrome.storage.local.set({
        pendingClip: {
          text: response.text,
          title: response.title,
          url: response.url,
          platform: response.platform,
          timestamp: Date.now(),
        },
      });
      // Open popup programmatically
      chrome.action.openPopup();
    }
  } catch (e) {
    // Content script not loaded, fallback to info.selectionText
    if (info.selectionText) {
      await chrome.storage.local.set({
        pendingClip: {
          text: info.selectionText,
          title: tab.title || "",
          url: info.pageUrl || "",
          platform: "",
          timestamp: Date.now(),
        },
      });
      chrome.action.openPopup();
    }
  }
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-selection") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "getSelection" });
    if (response && response.text) {
      await chrome.storage.local.set({
        pendingClip: {
          text: response.text,
          title: response.title || tab.title || "",
          url: response.url || tab.url || "",
          platform: response.platform,
          timestamp: Date.now(),
        },
      });
      chrome.action.openPopup();
    }
  } catch (e) {
    // Fallback
  }
});

// API helper
async function getApiBase() {
  const result = await chrome.storage.sync.get(["apiBase"]);
  return result.apiBase || DEFAULT_API_BASE;
}

async function getApiKey() {
  const result = await chrome.storage.sync.get(["apiKey"]);
  return result.apiKey || "";
}

// Expose API functions for popup to use via messaging
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchWorkspaces") {
    (async () => {
      try {
        const apiBase = await getApiBase();
        const apiKey = await getApiKey();
        if (!apiKey) {
          sendResponse({ error: "请先配置 API Key" });
          return;
        }
        const res = await fetch(`${apiBase}/api/external/workspaces`, {
          headers: { "X-API-Key": apiKey },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          sendResponse({ error: err.detail || `HTTP ${res.status}` });
          return;
        }
        sendResponse({ data: await res.json() });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "saveCard") {
    (async () => {
      try {
        const apiBase = await getApiBase();
        const apiKey = await getApiKey();
        if (!apiKey) {
          sendResponse({ error: "请先配置 API Key" });
          return;
        }
        const res = await fetch(`${apiBase}/api/external/cards`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify(request.data),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          sendResponse({ error: err.detail || `HTTP ${res.status}` });
          return;
        }
        sendResponse({ data: await res.json() });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
});
