(() => {
  'use strict';
  if (window.__tweaks_content) return;
  window.__tweaks_content = true;

  const INK = '#1C1917';
  const CARD = '#FFFFFF';
  const LINE = '#E9E2D6';
  const reduceMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function toast(text) {
    document.querySelectorAll('.__tweaks-toast').forEach((n) => n.remove());
    const el = document.createElement('div');
    el.className = '__tweaks-toast';
    el.textContent = text;
    el.style.cssText =
    `position:fixed;right:16px;bottom:16px;z-index:2147483647;background:${INK};` +
    `color:#FAF7F2;font:13px/1.4 system-ui,sans-serif;padding:10px 14px;border-radius:10px;` +
    `box-shadow:0 4px 16px rgba(0,0,0,.25);${reduceMotion ? '' : 'transition:opacity .4s;'}`;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), reduceMotion ? 0 : 450);
    }, 1800);
  }

  /* ---- selection save button ---- */
  let selBtn = null;
  let selTimer = 0;

  function hideSelBtn() {
    if (selBtn) {
      selBtn.remove();
      selBtn = null;
    }
  }

  function insideTweaks(node) {
    if (!node || node === document) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return Boolean(el && el.closest && el.closest('.__tweaks-selbtn,.__tweaks-region,.__tweaks-toast,.__tweaks-palette,.__tweaks-reason'));
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = window.getSelection();
      const anchor = sel ? sel.anchorNode : null;
      const text = sel && !sel.isCollapsed ? sel.toString().trim() : '';
      if (!text || text.length < 10 || insideTweaks(anchor) || !sel.rangeCount) {
        hideSelBtn();
        return;
      }
      hideSelBtn();
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Save to Tweaks';
      btn.className = '__tweaks-selbtn';
      btn.style.cssText =
        `position:fixed;z-index:2147483647;cursor:pointer;` +
        `left:${Math.min(window.innerWidth - 150, Math.max(8, r.left))}px;` +
        `top:${Math.max(8, Math.min(window.innerHeight - 60, r.bottom + 8))}px;` +
        `background:${CARD};color:${INK};border:1px solid ${LINE};` +
        `font:12px/1 system-ui,sans-serif;padding:8px 12px;border-radius:10px;` +
        `box-shadow:0 2px 10px rgba(0,0,0,.15);`;
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        hideSelBtn();
        try {
          await chrome.runtime.sendMessage({ action: 'capture-selection', text: text.slice(0, 4000) });
        } catch {
          toast('Tweaks: save failed — is the extension on?');
        }
        if (sel) sel.removeAllRanges();
      });
      document.body.appendChild(btn);
      selBtn = btn;
    }, 300);
  });

  document.addEventListener('scroll', hideSelBtn, { capture: true, passive: true });
  document.addEventListener('mousedown', (e) => {
    if (selBtn && e.target !== selBtn) hideSelBtn();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideSelBtn();
  });

  /* ---- region capture overlay ---- */
  function startRegion() {
    if (document.querySelector('.__tweaks-region')) return;
    const ac = new AbortController();
    const overlay = document.createElement('div');
    overlay.className = '__tweaks-region';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(28,25,23,.25);';
    const box = document.createElement('div');
    box.style.cssText =
      `position:fixed;display:none;border:2px solid ${INK};background:rgba(250,247,242,.15);` +
      'z-index:2147483647;pointer-events:none;';
    const bar = document.createElement('div');
    bar.style.cssText =
      `position:fixed;display:none;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);` +
      `background:${CARD};border:1px solid ${LINE};border-radius:12px;padding:8px 10px;` +
      `font:13px system-ui,sans-serif;color:${INK};box-shadow:0 4px 16px rgba(0,0,0,.2);` +
      'align-items:center;gap:10px;';
    const size = document.createElement('span');
    const capBtn = document.createElement('button');
    capBtn.type = 'button';
    capBtn.textContent = 'Capture this';
    capBtn.style.cssText =
      `background:${INK};color:#FAF7F2;border:0;border-radius:8px;padding:7px 12px;` +
      'font:13px system-ui,sans-serif;cursor:pointer;';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText =
      `background:transparent;color:${INK};border:1px solid ${LINE};border-radius:8px;` +
      'padding:6px 12px;font:13px system-ui,sans-serif;cursor:pointer;';
    bar.append(size, capBtn, cancelBtn);
    document.body.append(overlay, box, bar);

    let start = null;
    let rect = null;

    function cleanup() {
      ac.abort();
      overlay.remove();
      box.remove();
      bar.remove();
    }
    function onKey(e) {
      if (e.key === 'Escape') cleanup();
    }
    overlay.addEventListener('mousedown', (e) => {
      start = { x: e.clientX, y: e.clientY };
      rect = null;
      bar.style.display = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!start) return;
      rect = {
        x: Math.min(start.x, e.clientX),
        y: Math.min(start.y, e.clientY),
        w: Math.abs(e.clientX - start.x),
        h: Math.abs(e.clientY - start.y),
      };
      box.style.display = 'block';
      box.style.left = `${rect.x}px`;
      box.style.top = `${rect.y}px`;
      box.style.width = `${rect.w}px`;
      box.style.height = `${rect.h}px`;
      size.textContent = `${rect.w} × ${rect.h}`;
    }, { signal: ac.signal });
    window.addEventListener('mouseup', () => {
      start = null;
      if (rect && rect.w > 8 && rect.h > 8) bar.style.display = 'flex';
      else {
        rect = null;
        box.style.display = 'none';
      }
    }, { signal: ac.signal });
    window.addEventListener('keydown', onKey, { signal: ac.signal });
    cancelBtn.addEventListener('click', cleanup);
    capBtn.addEventListener('click', async () => {
      const r = rect ? { ...rect, pageW: window.innerWidth, pageH: window.innerHeight } : null;
      cleanup();
      try {
        await chrome.runtime.sendMessage({ action: 'capture-region', rect: r });
      } catch {
        toast('Tweaks: region capture failed');
      }
    });
  }

  /* ---- capture palette (Alt+T / Option+T, Enter = full page) ---- */
  let paletteEl = null;

  function closePalette() {
    if (paletteEl) {
      paletteEl.remove();
      paletteEl = null;
    }
  }

  function openPalette() {
    if (paletteEl || !document.body) return;
    const wrap = document.createElement('div');
    wrap.className = '__tweaks-palette';
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:rgba(28,25,23,.3);' +
      'display:flex;justify-content:center;padding:14vh 16px 16px;';
    const card = document.createElement('div');
    card.style.cssText =
      `background:${CARD};color:${INK};border:1px solid ${LINE};border-radius:14px;` +
      'width:min(400px,92vw);height:fit-content;max-height:70vh;overflow:auto;' +
      'padding:10px;box-shadow:0 12px 40px rgba(0,0,0,.3);' +
      'font:13px/1.45 system-ui,sans-serif;';
    const title = document.createElement('div');
    title.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;padding:2px 6px 8px;';
    title.innerHTML =
      '<b style="font-size:15px;letter-spacing:-0.01em;">tweaks</b>' +
      '<span style="font-size:11px;color:#78716C;">Enter = full page · Esc closes</span>';
    card.appendChild(title);

    const run = async (action, extra) => {
      closePalette();
      if (action === 'region') {
        startRegion();
        return;
      }
      toast('Saving…');
      try {
        const res = await chrome.runtime.sendMessage({ action, ...(extra || {}) });
        if (!res || !res.ok) toast(`Tweaks: ${((res && res.error) || 'save failed').slice(0, 80)}`);
      } catch {
        toast('Tweaks: save failed — is the extension on?');
      }
    };

    const rows = [
      ['↵', 'Save full page', 'Screenshot + text + link', 'capture-full'],
      ['S', 'Snap anything', 'Drag to snap a capture', 'region'],
      ['B', 'Bookmark page', 'Link + text, no screenshot', 'capture-bookmark'],
      ['A', 'Save article', 'Clean reading text', 'capture-article'],
      ['C', 'Save AI chat', 'This conversation, both sides', 'capture-chat'],
      ['F', 'Full-page shot', 'Auto-scroll and stitch', 'capture-fullpage'],
    ];
    for (const [key, label, desc, action] of rows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.cssText =
        `display:flex;width:100%;align-items:center;gap:10px;text-align:left;background:transparent;` +
        `border:0;border-radius:10px;padding:8px;cursor:pointer;color:${INK};font:inherit;`;
      b.innerHTML =
        `<span style="min-width:26px;text-align:center;font-size:11px;color:#78716C;` +
        `border:1px solid ${LINE};border-radius:6px;padding:2px 6px;">${key}</span>` +
        `<span><b style="display:block;font-weight:600;">${label}</b>` +
        `<span style="font-size:11px;color:#78716C;">${desc}</span></span>`;
      b.addEventListener('click', () => run(action));
      b.addEventListener('mouseenter', () => { b.style.background = '#F5F0E8'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
      card.appendChild(b);
    }

    const linkRow = document.createElement('div');
    linkRow.style.cssText = 'display:flex;gap:6px;padding:8px 6px 4px;';
    const linkInput = document.createElement('input');
    linkInput.placeholder = '…or paste any link ⏎';
    linkInput.style.cssText =
      `flex:1;font:inherit;color:${INK};background:#FAF7F2;border:1px solid ${LINE};` +
      'border-radius:8px;padding:7px 9px;';
    linkInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && linkInput.value.trim()) run('capture-link', { url: linkInput.value.trim() });
      if (e.key === 'Escape') closePalette();
    });
    linkRow.appendChild(linkInput);
    card.appendChild(linkRow);

    wrap.appendChild(card);
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap) closePalette();
    });
    const onKey = (e) => {
      if (!paletteEl) {
        document.removeEventListener('keydown', onKey, true);
        return;
      }
      if (e.target === linkInput) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Enter') {
        e.preventDefault();
        run('capture-full');
      } else if (k === 's' || k === 'r') run('region');
      else if (k === 'b') run('capture-bookmark');
      else if (k === 'a') run('capture-article');
      else if (k === 'c') run('capture-chat');
      else if (k === 'f') run('capture-fullpage');
      else if (e.key === 'Escape') closePalette();
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    paletteEl = wrap;
  }

  /* ---- reason-after-save prompt ---- */
  function openReason(saveId, title) {
    if (!document.body) return;
    document.querySelectorAll('.__tweaks-reason').forEach((n) => n.remove());
    const wrap = document.createElement('div');
    wrap.className = '__tweaks-reason';
    wrap.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(330px,90vw);' +
      `background:${CARD};color:${INK};border:1px solid ${LINE};border-radius:14px;` +
      'box-shadow:0 12px 40px rgba(0,0,0,.28);padding:12px 14px;' +
      'font:13px/1.45 system-ui,sans-serif;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:8px;';
    head.innerHTML =
      '<b style="font-size:14px;">Saved ✓</b>' +
      `<span style="font-size:11px;color:#78716C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;">${String(title || '').replace(/[<>&"]/g, '')}</span>`;
    const q = document.createElement('label');
    q.style.cssText = 'display:block;margin:8px 0 6px;font-size:12px;color:#78716C;';
    q.textContent = 'Why are you saving this?';
    const box = document.createElement('textarea');
    box.rows = 2;
    box.maxLength = 500;
    box.placeholder = 'The feeling I want our start page to have…';
    box.style.cssText =
      `width:100%;font:inherit;color:${INK};background:#FAF7F2;border:1px solid ${LINE};` +
      'border-radius:10px;padding:8px 10px;resize:vertical;box-sizing:border-box;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:8px;justify-content:flex-end;';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.textContent = 'Skip';
    skip.style.cssText =
      `background:transparent;color:${INK};border:1px solid ${LINE};border-radius:8px;` +
      'padding:7px 12px;font:inherit;cursor:pointer;';
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.textContent = 'Keep ⏎';
    keep.style.cssText =
      `background:${INK};color:#FAF7F2;border:0;border-radius:8px;padding:7px 14px;` +
      'font:inherit;font-weight:600;cursor:pointer;';
    const close = () => wrap.remove();
    const submit = async () => {
      const reason = box.value.trim();
      if (!reason) {
        close();
        return;
      }
      keep.disabled = true;
      try {
        await chrome.runtime.sendMessage({ action: 'update-reason', id: saveId, reason });
        toast('Reason kept ✓');
      } catch {
        toast('Tweaks: could not keep that reason');
      }
      close();
    };
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
      if (e.key === 'Escape') close();
    });
    skip.addEventListener('click', close);
    keep.addEventListener('click', submit);
    row.append(skip, keep);
    wrap.append(head, q, box, row);
    document.body.appendChild(wrap);
    setTimeout(() => box.focus(), 50);
  }

  /* ---- AI chat extraction (per-host rules + generic fallback) ---- */
  const CHAT_RULES = [
    {
      hosts: ['chatgpt.com', 'chat.openai.com'],
      items: [
        { sel: '[data-message-author-role="user"]', role: 'user' },
        { sel: '[data-message-author-role="assistant"]', role: 'assistant' },
      ],
      text: (el) => ((el.querySelector('.markdown') || el).innerText || ''),
    },
    {
      hosts: ['claude.ai'],
      items: [
        { sel: '[data-testid="user-message"], .font-user-message', role: 'user' },
        { sel: '.font-claude-message:not(#markdown-artifact), div.font-claude-response, [data-testid="assistant-message"]', role: 'assistant' },
      ],
    },
    {
      hosts: ['gemini.google.com'],
      items: [
        { sel: 'user-query', role: 'user' },
        { sel: 'model-response', role: 'assistant' },
      ],
    },
    { hosts: ['grok.com', 'copilot.microsoft.com', 'perplexity.ai', 'chat.mistral.ai', 'poe.com'], items: [] },
  ];
  const GENERIC_CHAT = [
    { sel: '[data-message-author-role="user"], .human-turn', role: 'user' },
    { sel: '[data-message-author-role="assistant"], .assistant-turn', role: 'assistant' },
    { sel: '.message-content', role: '?' },
  ];

  function extractChat() {
    const host = location.hostname || '';
    const rule = CHAT_RULES.find((r) => r.hosts.some((h) => host.includes(h)));
    const items = [...(rule ? rule.items : []), ...GENERIC_CHAT];
    const found = [];
    const seen = new Set();
    for (const it of items) {
      let els = [];
      try {
        els = document.querySelectorAll(it.sel);
      } catch {
        continue;
      }
      for (const el of els) {
        if (seen.has(el)) continue;
        seen.add(el);
        let role = it.role;
        if (role === '?') {
          const tagged = el.closest('[data-message-author-role]') || el.querySelector('[data-message-author-role]');
          const r = tagged && tagged.getAttribute('data-message-author-role');
          if (r === 'user' || r === 'assistant') role = r;
          else continue;
        }
        let text = '';
        try {
          text = (rule && rule.text ? rule.text(el) : el.innerText || '').trim();
        } catch {
          text = '';
        }
        if (!text) continue;
        found.push({ el, role, text: text.slice(0, 4000) });
      }
    }
    found.sort((a, b) => {
      if (a.el === b.el) return 0;
      return (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_PRECEDING) ? 1 : -1;
    });
    // Drop nested-container duplicates: keep the shorter (more precise) text.
    const turns = [];
    for (const f of found) {
      const last = turns[turns.length - 1];
      if (
        last &&
        (last.text === f.text ||
          (f.text.includes(last.text) && f.text.length > last.text.length * 1.5) ||
          (last.text.includes(f.text) && last.text.length > f.text.length * 1.5))
      ) {
        if (f.text.length < last.text.length) turns[turns.length - 1] = { role: f.role, text: f.text };
        continue;
      }
      turns.push({ role: f.role, text: f.text });
      if (turns.length >= 200) break;
    }
    if (!turns.length) return { ok: false, error: 'no chat turns found on this page' };
    return { ok: true, title: document.title || 'AI chat', turns };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.action === 'region-start') {
      startRegion();
      return;
    }
    if (msg.action === 'palette-open') {
      openPalette();
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === 'reason-ask') {
      toast('Saved ✓');
      openReason(msg.id, msg.title || '');
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === 'detect-kind') {
      try {
        const articleEl = document.querySelector('article') || document.querySelector('main');
        const articleChars = ((articleEl && articleEl.innerText) || '').trim().length;
        const hasVideo =
          Boolean(document.querySelector('video')) ||
          /youtube\.com\/watch|youtu\.be\/|vimeo\.com\/\d|tiktok\.com\/.+\/video|dailymotion\.com\/video/i.test(location.href || '');
        sendResponse({ ok: true, articleChars, hasVideo });
      } catch (e) {
        sendResponse({ ok: false });
      }
      return;
    }
    if (msg.action === 'extract-chat') {
      try {
        sendResponse({ action: 'extract-chat', ...extractChat() });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (msg.action === 'fullshot-dims') {
      sendResponse({
        ok: true,
        dims: {
          fullW: document.documentElement.scrollWidth,
          fullH: document.documentElement.scrollHeight,
          viewW: window.innerWidth,
          viewH: window.innerHeight,
        },
      });
      return;
    }
    if (msg.action === 'fullshot-scroll') {
      window.scrollTo(0, msg.y || 0);
      sendResponse({ ok: true });
      return;
    }
  });
})();
