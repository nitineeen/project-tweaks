'use strict';

/**
 * Link enrichment: turn a bare pasted URL into title/text/thumbnail.
 * extractMeta is pure (HTML in → fields out). enrichLink does network I/O
 * with tight timeouts and caps; it never throws — {} on any failure.
 */

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCharCode(Number(n));
      } catch {
        return '';
      }
    });
}

function metaContent(html, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*?content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+?content=["']([^"']*)["'][^>]*?(?:property|name)=["']${esc}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(m[1]).trim();
  }
  return '';
}

function resolveUrl(maybeRelative, base) {
  if (!maybeRelative) return '';
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return '';
  }
}

export function extractMeta(html, url) {
  const doc = String(html || '').slice(0, 600000);
  const titleTag = decodeEntities((doc.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
  const title = metaContent(doc, 'og:title') || titleTag;
  const description = metaContent(doc, 'og:description') || metaContent(doc, 'description');
  const image = resolveUrl(metaContent(doc, 'og:image'), url);
  const type = metaContent(doc, 'og:type');
  const hasVideo = Boolean(metaContent(doc, 'og:video') || metaContent(doc, 'og:video:url'));
  const isVideo =
    /youtube\.com\/watch|youtu\.be\/|vimeo\.com\/\d|tiktok\.com\/.+\/video|dailymotion\.com\/video/i.test(url || '') ||
    type === 'video' ||
    type === 'video.other' ||
    type.startsWith('video') ||
    hasVideo;
  return { title, description, image, type, isVideo };
}

async function fetchJson(url, ms) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

/** Crude readability: drop boilerplate tags, strip the rest, collapse space. */
export function extractText(html) {
  const doc = String(html || '').slice(0, 800000);
  const clean = doc
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(clean).replace(/\s+/g, ' ').trim().slice(0, 12000);
}

/** Fetch a live page as title + text. Never throws — {} on any failure. */
export async function fetchPageText(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Tweaks/0.1 (think agent)' },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    if (!res.ok) return {};
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html')) return {};
    const html = await res.text();
    const m = extractMeta(html, res.url || url);
    return { title: m.title, text: extractText(html), finalUrl: res.url || url };
  } catch {
    return {};
  }
}

export async function enrichLink(url) {
  try {
    if (/youtube\.com\/watch|youtu\.be\//i.test(url)) {
      const o = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, 8000);
      return {
        title: o.author_name ? `${o.title || 'Video'} — ${o.author_name}` : o.title || '',
        text: o.author_name ? `Video by ${o.author_name}.` : '',
        image_url: o.thumbnail_url || '',
        isVideo: true,
      };
    }
    if (/vimeo\.com\/\d/i.test(url)) {
      const o = await fetchJson(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`, 8000);
      return {
        title: o.author_name ? `${o.title || 'Video'} — ${o.author_name}` : o.title || '',
        text: o.author_name ? `Video by ${o.author_name}.` : '',
        image_url: o.thumbnail_url || '',
        isVideo: true,
      };
    }
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Tweaks/0.1 (link preview)' },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    if (!res.ok) return {};
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html')) return {};
    const html = (await res.text()).slice(0, 600000);
    const m = extractMeta(html, res.url || url);
    return {
      title: m.title,
      text: m.description,
      image_url: m.image,
      isVideo: m.isVideo,
    };
  } catch {
    return {};
  }
}
