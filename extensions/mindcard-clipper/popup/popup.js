// Popup script: handles the save confirmation UI

let pendingClip = null;
let workspaces = [];

async function init() {
  // Check API key
  const { apiKey } = await chrome.storage.sync.get(["apiKey"]);
  if (!apiKey) {
    document.getElementById("no-key-warning").style.display = "block";
    document.getElementById("main-form").style.display = "none";
    document.getElementById("open-options").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  document.getElementById("no-key-warning").style.display = "none";
  document.getElementById("main-form").style.display = "block";

  // Load workspaces
  loadWorkspaces();

  // Check for pending clip from context menu
  const { pendingClip: clip } = await chrome.storage.local.get(["pendingClip"]);
  if (clip && Date.now() - clip.timestamp < 60000) {
    pendingClip = clip;
    document.getElementById("content").value = clip.text;
    document.getElementById("meta").textContent =
      `${clip.platform || "网页"} · ${clip.url ? new URL(clip.url).hostname : ""}`;
    // Clear pending clip
    await chrome.storage.local.remove(["pendingClip"]);
  } else {
    // Try to get current selection from active tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "getSelection" });
        if (response && response.text) {
          pendingClip = response;
          document.getElementById("content").value = response.text;
          document.getElementById("meta").textContent =
            `${response.platform || "网页"} · ${response.url ? new URL(response.url).hostname : ""}`;
        }
      }
    } catch (e) {
      // No content script available
    }
  }

  // Load saved default workspace
  const { defaultWorkspace } = await chrome.storage.sync.get(["defaultWorkspace"]);
  if (defaultWorkspace) {
    // Will be set after workspaces load
    pendingClip = pendingClip || {};
    pendingClip._defaultWorkspace = defaultWorkspace;
  }
}

async function loadWorkspaces() {
  const select = document.getElementById("workspace");
  select.innerHTML = '<option value="">加载中...</option>';

  const response = await chrome.runtime.sendMessage({ action: "fetchWorkspaces" });
  if (response.error) {
    select.innerHTML = `<option value="">${response.error}</option>`;
    return;
  }

  workspaces = response.data || [];
  select.innerHTML = workspaces.length
    ? workspaces.map((ws) => `<option value="${ws.id}">${ws.name}</option>`).join("")
    : '<option value="">没有可用的工作区</option>';

  // Set default workspace if saved
  if (pendingClip?._defaultWorkspace) {
    const match = workspaces.find((ws) => ws.id === pendingClip._defaultWorkspace);
    if (match) select.value = match.id;
  }

  // Also load from storage
  const { defaultWorkspace } = await chrome.storage.sync.get(["defaultWorkspace"]);
  if (defaultWorkspace) {
    const match = workspaces.find((ws) => ws.id === defaultWorkspace);
    if (match) select.value = match.id;
  }
}

// Save card
document.getElementById("save").addEventListener("click", async () => {
  const btn = document.getElementById("save");
  btn.disabled = true;
  btn.textContent = "保存中...";

  const content = document.getElementById("content").value.trim();
  const title = document.getElementById("title").value.trim();
  const workspaceId = document.getElementById("workspace").value;
  const keywordsStr = document.getElementById("keywords").value.trim();
  const keywords = keywordsStr
    ? keywordsStr.split(/[,，、\s]+/).filter(Boolean).slice(0, 5)
    : [];

  if (!content) {
    alert("内容不能为空");
    btn.disabled = false;
    btn.textContent = "保存";
    return;
  }

  if (!workspaceId) {
    alert("请选择工作区");
    btn.disabled = false;
    btn.textContent = "保存";
    return;
  }

  const data = {
    workspace_id: workspaceId,
    title,
    content,
    keywords,
    source_platform: pendingClip?.platform || "",
    source_url: pendingClip?.url || "",
    local_id: "clip_" + Date.now(),
  };

  const response = await chrome.runtime.sendMessage({ action: "saveCard", data });

  if (response.error) {
    alert("保存失败: " + response.error);
    btn.disabled = false;
    btn.textContent = "保存";
    return;
  }

  // Success
  document.getElementById("main-form").style.display = "none";
  document.getElementById("success").style.display = "block";
  setTimeout(() => window.close(), 1200);
});

// Cancel
document.getElementById("cancel").addEventListener("click", () => {
  window.close();
});

// Init
init();
