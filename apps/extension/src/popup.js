'use strict';
/* Tweaks popup — reason first, Enter = save full page. */

const $ = (id) => document.getElementById(id);
const SAVES_KEY = 'tweaks_saves_v1';
const SETTINGS_KEY = 'tweaks_settings_v1';

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function timeAgo(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function chipFor(status) {
  if (status === 'sent') return '<span class="chip sent">filed ✓</span>';
  if (status === 'queued') return '<span class="chip queued">finishing…</span>';
  return '<span class="chip">local ✓</span>';
}

const TYPE_LABEL = {
  page: 'Page', region: 'Region', image: 'Image', article: 'Article',
  video: 'Video', link: 'Link', chat: 'Chat',
};

function rowHtml(save) {
  const reason = save.user_reason
    ? `<div class="r">${esc(save.user_reason)}</div>`
    : `<div class="r empty" data-addreason="${esc(save.id)}">+ add reason…</div>`;
  return (
    `<li><div class="t">${esc(save.page_title || '(untitled)')}</div>` +
    `<div class="m"><span>${esc(TYPE_LABEL[save.type] || 'Page')}</span><span>·</span>` +
    `<span>${esc(hostOf(save.original_url))}</span><span>·</span>` +
    `<span>${esc(timeAgo(save.created_at))}</span>${chipFor(save.status)}</div>${reason}</li>`
  );
}

async function renderRecents() {
  const found = await chrome.storage.local.get(SAVES_KEY);
  const saves = Array.isArray(found[SAVES_KEY]) ? found[SAVES_KEY] : [];
  $('recents').innerHTML = saves.length
    ? saves.slice(0, 5).map(rowHtml).join('')
    : '<li><div class="m">Nothing yet — save your first spark above.</div></li>';
  $('recents').querySelectorAll('[data-addreason]').forEach((el) => {
    el.addEventListener('click', () => inlineReason(el, el.dataset.addreason));
  });
}

function inlineReason(el, id) {
  const input = document.createElement('input');
  input.className = 'redit';
  input.maxLength = 500;
  input.placeholder = 'Why are you saving this? ⏎ to keep';
  el.replaceWith(input);
  input.focus();
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const res = await chrome.runtime.sendMessage({ action: 'update-reason', id, reason: input.value });
    if (res && res.ok) renderRecents();
  });
}

function setStatus(html) {
  $('status').innerHTML = html;
}

/* After an empty-reason popup save, raise the on-page "why" prompt so no
   save path ever skips it. Injects the content script into stale tabs. */
async function askOnPage(save) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return false;
    const msg = { action: 'reason-ask', id: save.id, title: save.page_title || '' };
    try {
      await chrome.tabs.sendMessage(tab.id, msg);
      return true;
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
      await chrome.tabs.sendMessage(tab.id, msg);
      return true;
    }
  } catch {
    return false;
  }
}

/* Restricted pages (chrome://, web store) can't show the on-page prompt —
   attach the reason right here instead. */
function inlineFallback(saveId) {
  const box = document.createElement('input');
  box.className = 'redit';
  box.maxLength = 500;
  box.placeholder = 'Why saving this? ⏎ to keep (this page blocks popups)';
  box.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !box.value.trim()) return;
    const res = await chrome.runtime.sendMessage({ action: 'update-reason', id: saveId, reason: box.value.trim() });
    if (res && res.ok) {
      const done = document.createElement('span');
      done.className = 'ok';
      done.textContent = 'Reason kept ✓';
      box.replaceWith(done);
      renderRecents();
    }
  });
  $('status').appendChild(document.createElement('br'));
  $('status').appendChild(box);
  box.focus();
}

let busy = false;

async function doSave(action) {
  if (busy) return;
  busy = true;
  const btn = $('save');
  btn.disabled = true;
  document.querySelectorAll('.ghost').forEach((b) => { b.disabled = true; });
  setStatus('Saving…');
  const reason = $('reason').value.trim();
  try {
    const res = await chrome.runtime.sendMessage({ action, reason });
    if (res && res.ok) {
      $('reason').value = '';
      updateCount();
      await renderRecents();
      setStatus(
        res.save.status === 'sent'
          ? '<span class="ok">Saved ✓ — filed by the backend.</span>'
          : '<span class="ok">Saved ✓</span> — stored locally, finishing in the background.'
      );
      if (res.save && !reason) {
        const asked = await askOnPage(res.save);
        if (!asked) inlineFallback(res.save.id);
      }
    } else {
      setStatus(`Save failed: ${esc((res && res.error) || 'unknown error')}`);
    }
  } catch (e) {
    setStatus(`Save failed: ${esc(e.message || e)}`);
  }
  btn.disabled = false;
  document.querySelectorAll('.ghost').forEach((b) => { b.disabled = false; });
  busy = false;
}

async function doSaveLink() {
  const url = $('link').value.trim();
  if (!url) {
    setStatus('Paste a link first.');
    return;
  }
  setStatus('Saving link…');
  try {
    const reason = $('reason').value.trim();
    const res = await chrome.runtime.sendMessage({ action: 'capture-link', url, reason });
    if (res && res.ok) {
      $('link').value = '';
      $('reason').value = '';
      updateCount();
      await renderRecents();
      setStatus('<span class="ok">Saved ✓</span> — link stored, title fills in on upload.');
      if (res.save && !reason) {
        const asked = await askOnPage(res.save);
        if (!asked) inlineFallback(res.save.id);
      }
    } else {
      setStatus(`Save failed: ${esc((res && res.error) || 'unknown error')}`);
    }
  } catch (e) {
    setStatus(`Save failed: ${esc(e.message || e)}`);
  }
}

/* Smart suggestion: article / video detected on this page. */
async function detectSmart() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    let res;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { action: 'detect-kind' });
    } catch {
      return; // no content script (restricted page) — primaries still work
    }
    if (!res || !res.ok) return;
    const box = $('smart');
    if (res.articleChars > 2000) {
      $('smartLabel').textContent = 'Article detected on this page';
      $('smartBtn').textContent = 'Save article';
      $('smartBtn').onclick = () => doSave('capture-article');
      box.hidden = false;
    } else if (res.hasVideo) {
      $('smartLabel').textContent = 'Video detected on this page';
      $('smartBtn').textContent = 'Save video';
      $('smartBtn').onclick = () => doSave('capture-video');
      box.hidden = false;
    }
  } catch {
    /* detection is best-effort */
  }
}

function updateCount() {
  $('count').textContent = `${$('reason').value.length} / 500`;
}

async function loadSettings() {
  const found = await chrome.storage.local.get(SETTINGS_KEY);
  const s = found[SETTINGS_KEY] || {};
  if (s.apiUrl) $('apiUrl').value = s.apiUrl;
  if (s.token) $('token').value = s.token;
  const linked = Boolean(s.apiUrl && s.token);
  $('mode').textContent = linked ? 'backend linked' : 'local mode';
  $('mode').classList.toggle('linked', linked);
  $('openSpace').href = `${(s.apiUrl || 'http://localhost:3121').replace(/\/$/, '')}/think`;
}

document.addEventListener('DOMContentLoaded', async () => {
  $('reason').addEventListener('input', updateCount);
  $('reason').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSave('capture-full');
    }
  });
  $('save').addEventListener('click', () => doSave('capture-full'));
  $('bookmark').addEventListener('click', () => doSave('capture-bookmark'));
  $('article').addEventListener('click', () => doSave('capture-article'));
  $('chat').addEventListener('click', () => doSave('capture-chat'));
  $('fullshot').addEventListener('click', () => doSave('capture-fullpage'));
  $('video').addEventListener('click', () => doSave('capture-video'));
  $('savelink').addEventListener('click', doSaveLink);
  $('link').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSaveLink();
    }
  });
  $('snap').addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'region-start' });
      window.close();
    } catch {
      setStatus('Snap needs a normal web page (not this popup).');
    }
  });
  if (navigator.platform && navigator.platform.includes('Mac')) {
    $('shortcutHint').textContent = '⌥T';
  }
  $('openSpace').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: $('openSpace').href });
  });
  $('saveSettings').addEventListener('click', async () => {
    await chrome.storage.local.set({
      [SETTINGS_KEY]: { apiUrl: $('apiUrl').value.trim(), token: $('token').value.trim() },
    });
    await chrome.runtime.sendMessage({ action: 'flush' });
    await loadSettings();
    await renderRecents();
    setStatus('Settings saved — queued saves retrying.');
  });
  await loadSettings();
  await renderRecents();
  detectSmart();
  try {
    await chrome.runtime.sendMessage({ action: 'flush' });
  } catch {
    /* service worker asleep; will flush on next save */
  }
});
