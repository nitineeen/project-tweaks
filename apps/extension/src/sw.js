'use strict';
/* Tweaks capture service worker (MV3) — local-first, backend-optional. */

const SAVES_KEY = 'tweaks_saves_v1';
const SETTINGS_KEY = 'tweaks_settings_v1';
const MAX_SAVES = 30;
const MAX_SHOTS = 10;

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dayParts(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    date_saved: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time_saved: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
  };
}

/* Runs in page context — must stay self-contained (no outside refs). */
function pageMetaFn() {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x + window.scrollX),
      y: Math.round(r.y + window.scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };
  const secs = [];
  const nodes = document.querySelectorAll('main section, main article, section');
  for (let i = 0; i < nodes.length && i < 8; i += 1) secs.push(box(nodes[i]));
  const ogContent = (prop) => {
    const m = document.querySelector(`meta[property="${prop}"]`) || document.querySelector(`meta[name="${prop}"]`);
    return m ? (m.getAttribute('content') || '') : '';
  };
  const articleEl = document.querySelector('article') || document.querySelector('main');
  return {
    title: document.title || '',
    url: (location && location.href) || '',
    text: (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 8000),
    article: ((articleEl || document.body).innerText || '').slice(0, 20000),
    og: {
      type: ogContent('og:type'),
      title: ogContent('og:title'),
      image: ogContent('og:image'),
      description: ogContent('og:description'),
    },
    landmarks: {
      header: box(document.querySelector('header')),
      main: box(document.querySelector('main')),
      footer: box(document.querySelector('footer')),
      sections: secs,
    },
  };
}

async function getMeta(tab) {
  const fallback = { title: (tab && tab.title) || '', url: (tab && tab.url) || '', text: '', article: '', og: null, landmarks: null };
  if (!tab || !tab.id) return fallback;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageMetaFn });
    return (res && res.result) || fallback;
  } catch {
    return fallback; // restricted pages (chrome://, web store, devtools)
  }
}

async function snapShot(windowId) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 });
  } catch {
    return null;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function cropShot(dataUrl, rect) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = rect.pageW ? bmp.width / rect.pageW : 1;
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const w = Math.min(bmp.width - sx, Math.round(rect.w * scale));
  const h = Math.min(bmp.height - sy, Math.round(rect.h * scale));
  if (w < 4 || h < 4) return dataUrl;
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bmp, sx, sy, w, h, 0, 0, w, h);
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  bmp.close();
  return blobToDataUrl(out);
}

async function loadSaves() {
  const found = await chrome.storage.local.get(SAVES_KEY);
  return Array.isArray(found[SAVES_KEY]) ? found[SAVES_KEY] : [];
}

async function getSettings() {
  const found = await chrome.storage.local.get(SETTINGS_KEY);
  return found[SETTINGS_KEY] || {};
}

async function persistSaves(saves) {
  const trimmed = saves
    .slice(0, MAX_SAVES)
    .map((s, i) => (i < MAX_SHOTS ? s : { ...s, screenshot: undefined }));
  await chrome.storage.local.set({ [SAVES_KEY]: trimmed });
  return trimmed;
}

function slim(save) {
  const copy = { ...save };
  delete copy.screenshot;
  copy.has_shot = Boolean(save.screenshot);
  return copy;
}

async function tryUpload(save) {
  const { apiUrl, token } = await getSettings();
  if (!apiUrl || !token) return 'local';
  try {
    const form = new FormData();
    form.set(
      'metadata',
      JSON.stringify({
        original_url: save.original_url,
        page_title: save.page_title,
        extracted_text: save.extracted_text,
        ocr_text: '',
        user_reason: save.user_reason,
        tz: save.tz,
        save_type: save.type,
        selection: save.selection || '',
        image_url: save.image_url || '',
        landmarks: save.landmarks || null,
      })
    );
    if (save.screenshot) {
      const blob = await (await fetch(save.screenshot)).blob();
      form.set('screenshot', blob, 'shot.jpg');
    }
    const res = await fetch(`${String(apiUrl).replace(/\/$/, '')}/api/saves`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return res.ok ? 'sent' : 'queued';
  } catch {
    return 'queued';
  }
}

function flashBadge(text) {
  try {
    chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
  } catch {
    /* badge is best-effort */
  }
}

/* Ask "why are you saving this?" on the page right after a background save
   (context menus, palette, selection, snap). Tabs with a stale or missing
   content script get it injected first; restricted pages just miss it. */
async function askReason(tabId, save) {
  if (!tabId || !save || save.user_reason) return;
  try {
    await sendToTab(tabId, { action: 'reason-ask', id: save.id, title: save.page_title || '' });
  } catch {
    /* restricted page (chrome://, web store) — popup recents cover it */
  }
}

async function finalize(partial) {
  const saves = await loadSaves();
  const status = await tryUpload(partial);
  const save = { ...partial, status };
  saves.unshift(save);
  await persistSaves(saves);
  flashBadge('✓');
  return { ok: true, save: slim(save) };
}

function baseSave(meta, tab, extra) {
  return {
    id: uid(),
    created_at: new Date().toISOString(),
    ...dayParts(),
    tz: (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC',
    original_url: meta.url || (tab && tab.url) || '',
    page_title: meta.title || (tab && tab.title) || '(untitled)',
    extracted_text: meta.text || '',
    user_reason: '',
    landmarks: meta.landmarks || null,
    ...extra,
  };
}

function isVideoPage(url, meta) {
  if (/youtube\.com\/watch|youtu\.be\/|vimeo\.com\/\d|tiktok\.com\/.+\/video|dailymotion\.com\/video/i.test(url || '')) return true;
  const t = meta && meta.og && meta.og.type;
  return t === 'video' || t === 'video.other' || String(t || '').startsWith('video');
}

async function captureFull(tab, { reason = '', bookmarkOnly = false } = {}) {
  const meta = await getMeta(tab);
  const screenshot = bookmarkOnly ? null : await snapShot(tab.windowId);
  const video = isVideoPage(meta.url || (tab && tab.url), meta);
  return finalize(
    baseSave(meta, tab, {
      type: video ? 'video' : 'page',
      user_reason: reason,
      screenshot,
      bookmark_only: bookmarkOnly,
      image_url: (video && meta.og && meta.og.image) || null,
    })
  );
}

async function saveSelection(text, tab, reason = '') {
  const meta = await getMeta(tab);
  return finalize(
    baseSave(meta, tab, {
      type: 'article', user_reason: reason, screenshot: null,
      selection: String(text || '').slice(0, 4000),
    })
  );
}

async function saveImage(srcUrl, tab, reason = '') {
  const meta = await getMeta(tab);
  return finalize(
    baseSave(meta, tab, { type: 'image', user_reason: reason, screenshot: null, image_url: srcUrl })
  );
}

async function captureRegion(tab, rect, reason = '') {
  const meta = await getMeta(tab);
  let screenshot = await snapShot(tab.windowId);
  if (screenshot && rect && rect.w > 4 && rect.h > 4) {
    try {
      screenshot = await cropShot(screenshot, rect);
    } catch {
      /* keep full screenshot */
    }
  }
  return finalize(
    baseSave(meta, tab, {
      type: 'region', user_reason: reason, screenshot,
      region: rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null,
    })
  );
}

async function updateReason(id, reason) {
  const saves = await loadSaves();
  const save = saves.find((s) => s.id === id);
  if (!save) return { ok: false, error: 'not found' };
  save.user_reason = String(reason || '').slice(0, 500);
  await persistSaves(saves);
  return { ok: true, save: slim(save) };
}

async function flush() {
  const saves = await loadSaves();
  let changed = false;
  for (const s of saves) {
    if (s.status === 'queued') {
      s.status = await tryUpload(s);
      changed = true;
    }
  }
  if (changed) await persistSaves(saves);
  return { ok: true };
}

const CHAT_URL_PATTERNS = [
  'https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://claude.ai/*',
  'https://gemini.google.com/*', 'https://grok.com/*', 'https://copilot.microsoft.com/*',
  'https://www.perplexity.ai/*', 'https://chat.mistral.ai/*',
];

function setupMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      createMenus();
    });
  } catch {
    createMenus();
  }
}

function createMenus() {
  chrome.contextMenus.create({ id: 'tweaks-bookmark', title: 'Bookmark page with Tweaks', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'tweaks-image', title: 'Save image with Tweaks', contexts: ['image'] });
  chrome.contextMenus.create({ id: 'tweaks-selection', title: 'Save selection with Tweaks', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'tweaks-link', title: 'Save link with Tweaks', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'tweaks-video', title: 'Save video with Tweaks', contexts: ['video'] });
  chrome.contextMenus.create({ id: 'tweaks-article', title: 'Save article with Tweaks', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'tweaks-chat', title: 'Save AI chat with Tweaks', contexts: ['page'], documentUrlPatterns: CHAT_URL_PATTERNS });
  chrome.contextMenus.create({ id: 'tweaks-fullshot', title: 'Save full-page screenshot', contexts: ['page'] });
}

chrome.runtime.onInstalled.addListener(setupMenus);
setupMenus();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    let res = null;
    if (info.menuItemId === 'tweaks-image') res = await saveImage(info.srcUrl, tab);
    else if (info.menuItemId === 'tweaks-selection') res = await saveSelection(info.selectionText || '', tab);
    else if (info.menuItemId === 'tweaks-bookmark') res = await captureFull(tab, { bookmarkOnly: true });
    else if (info.menuItemId === 'tweaks-link') res = await saveLink(info.linkUrl, tab);
    else if (info.menuItemId === 'tweaks-video') res = await saveVideo(info.srcUrl, tab);
    else if (info.menuItemId === 'tweaks-article') res = await saveArticle(tab);
    else if (info.menuItemId === 'tweaks-chat') res = await saveChat(tab);
    else if (info.menuItemId === 'tweaks-fullshot') res = await captureFullPage(tab);
    if (res && res.ok && tab && tab.id) await askReason(tab.id, res.save);
  } catch (e) {
    console.warn('tweaks menu failed', e);
  }
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'tweaks-capture') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    // Palette first (Enter = full page, S = snap, …). Stale tabs get the
    // content script injected; restricted pages fall back to a direct save.
    try {
      await sendToTab(tab.id, { action: 'palette-open' });
    } catch {
      const res = await captureFull(tab, {});
      if (res && res.ok) await askReason(tab.id, res.save);
    }
  } catch (e) {
    console.warn('tweaks command failed', e);
  }
});

async function activeTab(sender) {
  if (sender && sender.tab) return sender.tab;
  // lastFocusedWindow: the popup is never the "current" window for tabs.
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

/* Send to a tab, injecting the content script first when it's missing
   (stale tabs opened before install/update). Throws on restricted pages. */
async function sendToTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
    return;
  } catch {
    /* content script missing — inject (double-run guarded), then retry once */
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
  await chrome.tabs.sendMessage(tabId, msg);
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  (async () => {
    try {
      if (msg.action === 'update-reason') return respond(await updateReason(msg.id, msg.reason));
      if (msg.action === 'flush') return respond(await flush());
      if (msg.action === 'ping') return respond({ ok: true });
      const tab = await activeTab(sender);
      if (!tab) return respond({ ok: false, error: 'no active tab' });
      // Saves sent from a page (palette, selection, region) get the reason
      // prompt when no reason came with them. Popup saves (no sender.tab)
      // skip it: the popup itself is the reason box.
      const fromPage = Boolean(sender.tab && sender.tab.id);
      const bgSave = async (p) => {
        const r = await p;
        if (fromPage && r && r.ok && r.save && !r.save.user_reason) {
          await askReason(sender.tab.id, r.save);
        }
        return respond(r);
      };
      switch (msg.action) {
        case 'capture-full':
          return bgSave(captureFull(tab, { reason: msg.reason || '' }));
        case 'capture-bookmark':
          return bgSave(captureFull(tab, { reason: msg.reason || '', bookmarkOnly: true }));
        case 'capture-selection':
          return bgSave(saveSelection(msg.text || '', tab, msg.reason || ''));
        case 'capture-image':
          return bgSave(saveImage(msg.srcUrl, tab, msg.reason || ''));
        case 'capture-region':
          return bgSave(captureRegion(tab, msg.rect, msg.reason || ''));
        case 'capture-link':
          return bgSave(saveLink(msg.url || '', tab, msg.reason || ''));
        case 'capture-article':
          return bgSave(saveArticle(tab, msg.reason || ''));
        case 'capture-chat':
          return bgSave(saveChat(tab, msg.reason || ''));
        case 'capture-fullpage':
          return bgSave(captureFullPage(tab, msg.reason || ''));
        case 'capture-video':
          return bgSave(saveVideo('', tab, msg.reason || ''));
        case 'region-start':
          await sendToTab(tab.id, { action: 'region-start' });
          return respond({ ok: true });
        default:
          return respond({ ok: false, error: 'unknown action' });
      }
    } catch (e) {
      respond({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true;
});

/* ---------- link / video / article / chat / full-page ---------- */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (!/^[a-z]+:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

async function saveLink(rawUrl, tab, reason = '') {
  const url = normalizeUrl(rawUrl);
  if (!url) return { ok: false, error: 'not a valid http(s) link' };
  // Title/text come from server-side enrichment at upload time.
  const meta = { title: url, url, text: '', landmarks: null };
  return finalize(baseSave(meta, tab, { type: 'link', user_reason: reason, screenshot: null }));
}

async function saveVideo(srcUrl, tab, reason = '') {
  const meta = await getMeta(tab);
  const pageUrl = meta.url || (tab && tab.url) || '';
  return finalize(
    baseSave(meta, tab, {
      type: 'video',
      user_reason: reason,
      screenshot: null,
      image_url: (meta.og && meta.og.image) || null,
      selection: srcUrl ? `video file: ${srcUrl}` : '',
      original_url: pageUrl,
    })
  );
}

async function saveArticle(tab, reason = '') {
  const meta = await getMeta(tab);
  const text = (meta.article && meta.article.trim()) || meta.text || '';
  return finalize(
    baseSave(meta, tab, {
      type: 'article', user_reason: reason, screenshot: null, extracted_text: text.slice(0, 20000),
    })
  );
}

async function saveChat(tab, reason = '') {
  let res = null;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { action: 'extract-chat' });
  } catch {
    return { ok: false, error: 'could not read this page — reload it and retry' };
  }
  if (!res || !res.ok || !res.turns || !res.turns.length) {
    return { ok: false, error: (res && res.error) || 'no chat found here' };
  }
  const transcript = res.turns
    .map((t) => `${t.role === 'user' ? 'You' : 'Assistant'}:\n${t.text}`)
    .join('\n\n')
    .slice(0, 30000);
  const meta = await getMeta(tab);
  meta.title = `${res.title || 'AI chat'} (${res.turns.length} turns)`;
  return finalize(
    baseSave(meta, tab, { type: 'chat', user_reason: reason, screenshot: null, extracted_text: transcript })
  );
}

async function stitchShots(shots, dims) {
  const imgs = [];
  for (const s of shots) {
    imgs.push(await createImageBitmap(await (await fetch(s.shot)).blob()));
  }
  const scale = imgs[0].width / dims.viewW;
  const W = Math.round(dims.fullW * scale);
  const H = Math.round(Math.min(dims.fullH, shots.length * dims.viewH) * scale);
  const canvas = new OffscreenCanvas(Math.max(1, W), Math.max(1, H));
  const ctx = canvas.getContext('2d');
  imgs.forEach((bmp, i) => {
    const dy = Math.round(shots[i].y * scale);
    const sh = Math.min(bmp.height, H - dy);
    if (sh > 0) ctx.drawImage(bmp, 0, 0, bmp.width, sh, 0, dy, W, sh);
    bmp.close();
  });
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
  return blobToDataUrl(out);
}

async function captureFullPage(tab, reason = '') {
  const MAX_SHOTS = 12;
  let dims;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'fullshot-dims' });
    dims = res && res.dims;
    if (!dims || !dims.viewH) return { ok: false, error: 'could not measure page' };
  } catch {
    return { ok: false, error: 'could not read this page — reload it and retry' };
  }
  const shots = [];
  try {
    for (let y = 0; y < dims.fullH && shots.length < MAX_SHOTS; y += dims.viewH) {
      await chrome.tabs.sendMessage(tab.id, { action: 'fullshot-scroll', y });
      await sleep(400);
      const shot = await snapShot(tab.windowId);
      if (!shot) break;
      shots.push({ y, shot });
    }
  } finally {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'fullshot-scroll', y: 0 });
    } catch {
      /* leave scroll where it is */
    }
  }
  if (!shots.length) return { ok: false, error: 'screenshot failed' };
  const partial = dims.fullH > shots.length * dims.viewH;
  let screenshot;
  try {
    screenshot = await stitchShots(shots, dims);
  } catch {
    return { ok: false, error: 'could not stitch screenshots' };
  }
  const meta = await getMeta(tab);
  if (partial) meta.title = `${meta.title || 'Page'} (partial fullshot)`;
  return finalize(
    baseSave(meta, tab, { type: 'page', user_reason: reason, screenshot, fullpage: true })
  );
}
