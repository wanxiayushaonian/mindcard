// Options page script: save/load settings

async function loadSettings() {
  const { apiKey, apiBase, defaultWorkspace } = await chrome.storage.sync.get([
    "apiKey",
    "apiBase",
    "defaultWorkspace",
  ]);

  document.getElementById("apiKey").value = apiKey || "";
  document.getElementById("apiBase").value = apiBase || "http://localhost:8000";

  // Set link
  const base = apiBase || "http://localhost:8000";
  document.getElementById("link-to-keys").href = `${base.replace(/\/$/, "")}/settings/api-keys`;

  // Load workspaces if API key exists
  if (apiKey) {
    await loadWorkspaces(apiKey, apiBase || "http://localhost:8000", defaultWorkspace);
  }
}

async function loadWorkspaces(apiKey, apiBase, selectedId) {
  const select = document.getElementById("defaultWorkspace");
  try {
    const res = await fetch(`${apiBase}/api/external/workspaces`, {
      headers: { "X-API-Key": apiKey },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const workspaces = await res.json();

    select.innerHTML = '<option value="">不设置默认</option>';
    for (const ws of workspaces) {
      const opt = document.createElement("option");
      opt.value = ws.id;
      opt.textContent = ws.name;
      if (ws.id === selectedId) opt.selected = true;
      select.appendChild(opt);
    }
  } catch (e) {
    select.innerHTML = `<option value="">加载失败: ${e.message}</option>`;
  }
}

// Save
document.getElementById("save").addEventListener("click", async () => {
  const apiKey = document.getElementById("apiKey").value.trim();
  const apiBase = document.getElementById("apiBase").value.trim() || "http://localhost:8000";
  const defaultWorkspace = document.getElementById("defaultWorkspace").value;

  await chrome.storage.sync.set({ apiKey, apiBase, defaultWorkspace });

  // Update link
  document.getElementById("link-to-keys").href = `${apiBase.replace(/\/$/, "")}/settings/api-keys`;

  // Reload workspaces with new key
  if (apiKey) {
    await loadWorkspaces(apiKey, apiBase, defaultWorkspace);
  }

  // Show success
  const status = document.getElementById("status");
  status.classList.add("show");
  setTimeout(() => status.classList.remove("show"), 2000);
});

// When API key changes, try to reload workspaces
document.getElementById("apiKey").addEventListener("change", async () => {
  const apiKey = document.getElementById("apiKey").value.trim();
  const apiBase = document.getElementById("apiBase").value.trim() || "http://localhost:8000";
  if (apiKey) {
    await loadWorkspaces(apiKey, apiBase, "");
  }
});

// Init
loadSettings();
