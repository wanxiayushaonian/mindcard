// ── Markdown renderer (no external dep) ───────────────────────────────

const md = (() => {
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function inline(raw) {
    return esc(raw)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/_([^_\n]+)_/g, '<em>$1</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      // Only allow http/https URLs to prevent injection
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function render(text) {
    if (!text || !text.trim()) return '<p class="empty-hint">（暂无内容）</p>';
    const lines = text.split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block
      if (line.startsWith('```')) {
        const lang = esc(line.slice(3).trim());
        const code = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) code.push(esc(lines[i++]));
        i++;
        out.push(`<pre><code${lang ? ` class="lang-${lang}"` : ''}>${code.join('\n')}</code></pre>`);
        continue;
      }

      // Heading
      const hm = line.match(/^(#{1,6}) (.+)/);
      if (hm) {
        out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`);
        i++; continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        out.push('<hr>'); i++; continue;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        const bq = [];
        while (i < lines.length && lines[i].startsWith('> ')) bq.push(lines[i++].slice(2));
        out.push(`<blockquote><p>${inline(bq.join('\n'))}</p></blockquote>`);
        continue;
      }

      // Unordered list
      if (/^[*\-+] /.test(line)) {
        out.push('<ul>');
        while (i < lines.length && /^[*\-+] /.test(lines[i]))
          out.push(`<li>${inline(lines[i++].replace(/^[*\-+] /, ''))}</li>`);
        out.push('</ul>');
        continue;
      }

      // Ordered list
      if (/^\d+\. /.test(line)) {
        out.push('<ol>');
        while (i < lines.length && /^\d+\. /.test(lines[i]))
          out.push(`<li>${inline(lines[i++].replace(/^\d+\. /, ''))}</li>`);
        out.push('</ol>');
        continue;
      }

      // Empty line — skip (paragraph spacing handled by CSS margin)
      if (!line.trim()) { i++; continue; }

      // Paragraph (collect consecutive non-block lines)
      const para = [];
      while (
        i < lines.length && lines[i].trim() &&
        !lines[i].startsWith('#') && !lines[i].startsWith('>') &&
        !lines[i].startsWith('```') && !/^[*\-+] /.test(lines[i]) &&
        !/^\d+\. /.test(lines[i]) && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
      ) {
        para.push(lines[i++]);
      }
      if (para.length) out.push(`<p>${inline(para.join('<br>'))}</p>`);
    }

    return out.join('\n') || '<p class="empty-hint">（暂无内容）</p>';
  }

  return { render };
})();

// ── State ──────────────────────────────────────────────────────────────

let isPreview = false;
let clipSource = null;
let draftTimer = null;

const $ = id => document.getElementById(id);

// ── Preview toggle ─────────────────────────────────────────────────────

function setPreview(on) {
  isPreview = on;
  if (on) {
    $('preview').innerHTML = md.render($('content').value);
    $('content').style.display = 'none';
    $('preview').style.display = '';
    $('icon-eye').style.display = 'none';
    $('icon-pencil').style.display = '';
    $('toggle-preview').title = '编辑';
    $('toggle-preview').classList.add('active');
  } else {
    $('content').style.display = '';
    $('preview').style.display = 'none';
    $('icon-eye').style.display = '';
    $('icon-pencil').style.display = 'none';
    $('toggle-preview').title = '预览 Markdown';
    $('toggle-preview').classList.remove('active');
    $('content').focus();
  }
}

// ── Clip insertion ─────────────────────────────────────────────────────

function insertClip(clip) {
  clipSource = { platform: clip.platform, url: clip.url };

  // Update source badge
  const parts = [];
  if (clip.platform) parts.push(clip.platform);
  if (clip.url) { try { parts.push(new URL(clip.url).hostname); } catch (e) {} }
  if (parts.length) {
    $('clip-badge').textContent = '📎 ' + parts.join(' · ');
    $('clip-badge').style.display = '';
  }

  // Switch to edit mode if currently previewing
  if (isPreview) setPreview(false);

  const ta = $('content');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const before = ta.value.substring(0, start);
  const after = ta.value.substring(end);

  // Ensure blank lines around inserted text
  const prefix = before && !/\n\n$/.test(before) ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const suffix = after && !/^\n/.test(after) ? '\n\n' : '';
  const inserted = prefix + clip.text + suffix;

  ta.value = before + inserted + after;
  const newPos = start + inserted.length;
  ta.setSelectionRange(newPos, newPos);
  ta.focus();

  saveDraft();
  hideError();
}

// ── Draft persistence ──────────────────────────────────────────────────

function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    chrome.storage.local.set({
      draft: {
        title: $('title').value,
        content: $('content').value,
        keywords: $('keywords').value,
        workspaceId: $('workspace').value,
        clipSource,
      },
    });
  }, 600);
}

async function restoreDraft() {
  const { draft } = await chrome.storage.local.get(['draft']);
  if (!draft) return null;

  $('title').value = draft.title || '';
  $('content').value = draft.content || '';
  $('keywords').value = draft.keywords || '';

  if (draft.clipSource) {
    clipSource = draft.clipSource;
    const parts = [];
    if (draft.clipSource.platform) parts.push(draft.clipSource.platform);
    if (draft.clipSource.url) { try { parts.push(new URL(draft.clipSource.url).hostname); } catch (e) {} }
    if (parts.length) {
      $('clip-badge').textContent = '📎 ' + parts.join(' · ');
      $('clip-badge').style.display = '';
    }
  }

  return draft;
}

// ── Workspaces ─────────────────────────────────────────────────────────

async function loadWorkspaces(selectedId) {
  const sel = $('workspace');
  sel.innerHTML = '<option value="">加载中...</option>';

  const res = await chrome.runtime.sendMessage({ action: 'fetchWorkspaces' });
  if (res.error) {
    sel.innerHTML = `<option value="">${res.error}</option>`;
    return;
  }

  const wss = res.data || [];
  sel.innerHTML = '';
  if (!wss.length) {
    sel.innerHTML = '<option value="">没有可用的工作区</option>';
    return;
  }

  for (const ws of wss) {
    const opt = document.createElement('option');
    opt.value = ws.id;
    opt.textContent = ws.name;
    sel.appendChild(opt);
  }

  // Priority: draft workspace > default workspace > first
  const { defaultWorkspace } = await chrome.storage.sync.get(['defaultWorkspace']);
  const target = selectedId || defaultWorkspace;
  if (target && wss.find(w => w.id === target)) sel.value = target;
}

// ── Error ──────────────────────────────────────────────────────────────

function showError(msg) {
  $('error-text').textContent = msg;
  $('error-msg').style.display = 'flex';
}

function hideError() {
  $('error-msg').style.display = 'none';
}

// ── Save ───────────────────────────────────────────────────────────────

async function handleSave() {
  const content = $('content').value.trim();
  const workspaceId = $('workspace').value;

  if (!content) { showError('请输入内容'); return; }
  if (!workspaceId) { showError('请选择工作区'); return; }
  hideError();

  const btn = $('save-btn');
  btn.disabled = true;
  btn.textContent = '保存中...';

  const kwStr = $('keywords').value.trim();
  const keywords = kwStr ? kwStr.split(/[,，、\s]+/).filter(Boolean).slice(0, 5) : [];

  const res = await chrome.runtime.sendMessage({
    action: 'saveCard',
    data: {
      workspace_id: workspaceId,
      title: $('title').value.trim(),
      content,
      keywords,
      source_platform: clipSource?.platform || '',
      source_url: clipSource?.url || '',
    },
  });

  btn.disabled = false;
  btn.textContent = '保存到 MindCard';

  if (res.error) { showError('保存失败: ' + res.error); return; }

  // Clear editor and draft
  $('title').value = '';
  $('content').value = '';
  $('keywords').value = '';
  $('clip-badge').style.display = 'none';
  clipSource = null;
  chrome.storage.local.remove(['draft']);
  if (isPreview) setPreview(false);

  showToast('✓ 已保存到 MindCard');
}

function handleClear() {
  $('title').value = '';
  $('content').value = '';
  $('keywords').value = '';
  $('clip-badge').style.display = 'none';
  clipSource = null;
  chrome.storage.local.remove(['draft']);
  hideError();
  if (isPreview) setPreview(false);
  $('content').focus();
}

// ── Toast ──────────────────────────────────────────────────────────────

function showToast(msg) {
  const t = $('success-toast');
  t.querySelector('.toast-text').textContent = msg;
  t.style.display = 'flex';
  requestAnimationFrame(() => {
    t.classList.add('show');
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => { t.style.display = 'none'; }, 250);
    }, 2200);
  });
}

// ── Init ───────────────────────────────────────────────────────────────

async function init() {
  $('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('setup-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('toggle-preview').addEventListener('click', () => setPreview(!isPreview));
  $('save-btn').addEventListener('click', handleSave);
  $('clear-btn').addEventListener('click', handleClear);

  // Auto-save draft on every keystroke
  ['title', 'content', 'keywords'].forEach(id =>
    $(id).addEventListener('input', saveDraft)
  );
  $('workspace').addEventListener('change', saveDraft);

  // Check API key
  const { apiKey } = await chrome.storage.sync.get(['apiKey']);
  if (!apiKey) {
    $('no-key-state').style.display = '';
    $('editor-container').style.display = 'none';
    return;
  }

  $('no-key-state').style.display = 'none';
  $('editor-container').style.display = '';

  // Restore draft → load workspaces (to set saved workspace selection)
  const draft = await restoreDraft();
  await loadWorkspaces(draft?.workspaceId);

  // Check for pending clip from context menu / keyboard shortcut
  const { pendingClip } = await chrome.storage.local.get(['pendingClip']);
  if (pendingClip && Date.now() - pendingClip.timestamp < 60000) {
    insertClip(pendingClip);
    await chrome.storage.local.remove(['pendingClip']);
  }

  // React to new clips while panel is open (storage.onChanged fires even when
  // the panel is already open and sidebarAction.open() is called again)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.pendingClip?.newValue) return;
    const clip = changes.pendingClip.newValue;
    if (Date.now() - clip.timestamp < 60000) {
      insertClip(clip);
      chrome.storage.local.remove(['pendingClip']);
    }
  });
}

init();
