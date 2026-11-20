import { getSettings } from './settings.js';
import { getEngines, enabledEngines, effectiveDefault, resolveEngineIds } from './engines.js';

const MENU = { IMG: 'lenc-img', SUB: 'lenc-sub', SUBP: 'lenc-sub:', AREA: 'lenc-area' };
const MAX_BYTES = 5 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

let menuQueue = Promise.resolve();
function rebuildMenus() {
  menuQueue = menuQueue.then(doRebuild).catch((e) => console.error('LenC menu error', e));
  return menuQueue;
}

function createMenu(props) {
  chrome.contextMenus.create(props, () => void chrome.runtime.lastError);
}

async function doRebuild() {
  await chrome.contextMenus.removeAll();
  const s = await getSettings();
  const engines = enabledEngines(s);
  const def = effectiveDefault(s);
  const label = def === 'all' ? 'all engines' : engines.find((e) => e.id === def)?.short || 'the web';

  createMenu({ id: MENU.IMG, title: `Search image on ${label}`, contexts: ['image'] });

  if (s.contextSubmenu && engines.length > 1) {
    createMenu({ id: MENU.SUB, title: 'Search image on…', contexts: ['image'] });
    for (const e of engines) {
      createMenu({ id: MENU.SUBP + e.id, parentId: MENU.SUB, title: e.name, contexts: ['image'] });
    }
    createMenu({ id: MENU.SUBP + 'all', parentId: MENU.SUB, title: 'All enabled engines', contexts: ['image'] });
  }

  if (s.contextAreaItem) {
    createMenu({ id: MENU.AREA, title: `Select area to search on ${label}`, contexts: ['page', 'frame'] });
  }
}

chrome.runtime.onInstalled.addListener(() => rebuildMenus());
chrome.runtime.onStartup.addListener(() => rebuildMenus());
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') rebuildMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const s = await getSettings();
    const id = String(info.menuItemId);

    if (id === MENU.AREA) {
      await startAreaSelection(tab);
      return;
    }

    let requested;
    if (id === MENU.IMG) requested = effectiveDefault(s);
    else if (id.startsWith(MENU.SUBP)) requested = id.slice(MENU.SUBP.length);
    else return;

    const srcUrl = info.srcUrl;
    if (!srcUrl) throw new Error("Couldn't find the image address.");
    await runSearch({
      tab,
      s,
      engineIds: resolveEngineIds(s, requested),
      url: srcUrl,
      getBlob: () => blobFromUrl(srcUrl, tab?.id, info.frameId)
    });
  } catch (e) {
    toast(tab?.id, e.message || String(e), 'error');
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  try {
    tab = tab || (await getActiveTab());
    if (command === 'select-area') await startAreaSelection(tab);
    else if (command === 'search-visible') await searchVisible(tab);
    else if (command === 'search-fullpage') await searchFullPage(tab);
  } catch (e) {
    toast(tab?.id, e.message || String(e), 'error');
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(
    (r) => sendResponse({ ok: true, ...(r || {}) }),
    (e) => sendResponse({ ok: false, error: e?.message || String(e) })
  );
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg?.type) {
    case 'start-area':
      await startAreaSelection(await getActiveTab());
      return {};
    case 'search-visible':
      await searchVisible(await getActiveTab(), msg.engine);
      return {};
    case 'search-fullpage':
      await searchFullPage(await getActiveTab(), msg.engine);
      return {};
    case 'search-url': {
      const s = await getSettings();
      const url = String(msg.url || '').trim();
      if (!/^https?:\/\//i.test(url) && !/^data:image\//i.test(url)) {
        throw new Error('Enter a valid image address (starting with http:// or https://).');
      }
      await runSearch({
        tab: await getActiveTab(),
        s,
        engineIds: resolveEngineIds(s, msg.engine),
        url,
        getBlob: () => blobFromUrl(url)
      });
      return {};
    }
    case 'search-file': {
      const s = await getSettings();
      const blob = await (await fetch(msg.dataUrl)).blob();
      await runSearch({
        tab: await getActiveTab(),
        s,
        engineIds: resolveEngineIds(s, msg.engine),
        getBlob: async () => blob
      });
      return {};
    }
    case 'area-selected':
      await handleAreaSelected(msg, sender.tab);
      return {};
    default:
      return {};
  }
}

async function runSearch({ tab, s, engineIds, url, getBlob, raw = false }) {
  const engines = getEngines(s).filter((e) => engineIds.includes(e.id));
  if (!engines.length) throw new Error('No search engine is enabled. Open LenC settings to pick one.');

  const urlIsWeb = !!url && /^https?:\/\//i.test(url);
  const targets = [];
  const skipped = [];
  let stashId = null;
  let stashError = null;

  for (const e of engines) {
    const canUrl = urlIsWeb && typeof e.byUrl === 'function';
    if (canUrl && s.imageMethod === 'url') {
      targets.push(e.byUrl(url));
      continue;
    }
    if (e.upload && getBlob) {
      if (!stashId && !stashError) {
        try {
          stashId = await stashImage(await getBlob(), s, raw);
        } catch (err) {
          stashError = err;
        }
      }
      if (stashId) {
        targets.push(chrome.runtime.getURL(`upload.html?id=${stashId}&engine=${e.id}`));
        continue;
      }
    }
    if (canUrl) {
      targets.push(e.byUrl(url));
      continue;
    }
    skipped.push(e);
  }

  if (!targets.length) {
    if (stashError) throw stashError;
    const name = skipped[0]?.name || 'This engine';
    throw new Error(`${name} can only search images by address. Choose another engine for screenshots and uploads.`);
  }
  await openResultTabs(targets, tab, s);
}

async function openResultTabs(urls, tab, s) {
  for (let i = 0; i < urls.length; i++) {
    const props = { url: urls[i], active: !s.openInBackground && i === 0 };
    if (s.openNextToTab && tab?.index != null) {
      props.index = tab.index + 1 + i;
      props.windowId = tab.windowId;
    }
    if (tab?.id != null) props.openerTabId = tab.id;
    await chrome.tabs.create(props);
  }
}

async function fetchBlob(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Couldn't download the image (HTTP ${res.status}).`);
  return res.blob();
}

async function blobFromUrl(url, tabId, frameId = 0) {
  if (!url.startsWith('blob:')) return fetchBlob(url);
  if (tabId == null) throw new Error("Couldn't read this image.");
  const [res] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    args: [url],
    func: async (u) => {
      const r = await fetch(u);
      const b = await r.blob();
      return await new Promise((ok, fail) => {
        const fr = new FileReader();
        fr.onload = () => ok(fr.result);
        fr.onerror = fail;
        fr.readAsDataURL(b);
      });
    }
  });
  if (!res?.result) throw new Error("Couldn't read this image.");
  return (await fetch(res.result)).blob();
}

function cropToCanvas(src, sx, sy, sw, sh, maxDim, opaque) {
  const longSide = Math.max(sw, sh);
  const k = maxDim > 0 && longSide > maxDim ? maxDim / longSide : 1;
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (opaque) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  return canvas;
}

function scaleCanvas(src, factor) {
  const w = Math.max(1, Math.round(src.width * factor));
  const h = Math.max(1, Math.round(src.height * factor));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

async function encodeCanvas(canvas, s) {
  let type = s.format === 'png' ? 'image/png' : 'image/jpeg';
  let quality = s.quality;
  let c = canvas;
  let blob = await c.convertToBlob({ type, quality });
  for (let i = 0; i < 8 && blob.size > MAX_BYTES; i++) {
    if (type === 'image/png') {
      type = 'image/jpeg';
      c = scaleCanvas(c, 1);
      quality = 0.92;
    } else if (quality > 0.6) {
      quality -= 0.12;
    } else {
      c = scaleCanvas(c, 0.8);
    }
    blob = await c.convertToBlob({ type, quality });
  }
  return blob;
}

async function stashImage(blob, s, raw) {
  let out = blob;
  if (!raw) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      throw new Error("This image format can't be uploaded (for example SVG). Try the area selector instead.");
    }
    const passthrough = (blob.type === 'image/jpeg' || blob.type === 'image/png') && blob.size <= MAX_BYTES;
    if (!passthrough) {
      const canvas = cropToCanvas(bitmap, 0, 0, bitmap.width, bitmap.height, s.maxDimension, s.format === 'jpeg');
      out = await encodeCanvas(canvas, s);
    }
    bitmap.close?.();
  }
  await cleanupStale();
  const id = crypto.randomUUID();
  const b64 = await blobToBase64(out);
  await chrome.storage.session.set({ ['img:' + id]: { b64, mime: out.type || 'image/jpeg', ts: Date.now() } });
  return id;
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

async function cleanupStale() {
  const all = await chrome.storage.session.get(null);
  const dead = Object.keys(all).filter((k) => k.startsWith('img:') && Date.now() - (all[k]?.ts || 0) > 10 * 60 * 1000);
  if (dead.length) await chrome.storage.session.remove(dead);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error('No active tab found.');
  return tab;
}

function assertCapturable(tab) {
  const u = tab?.url || '';
  if (
    !tab?.id ||
    /^(chrome|edge|about|devtools|view-source|chrome-extension|chrome-search):/i.test(u) ||
    /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(u)
  ) {
    throw new Error("Chrome doesn't let extensions capture this kind of page. Try it on a regular website.");
  }
}

async function startAreaSelection(tab) {
  tab = tab || (await getActiveTab());
  assertCapturable(tab);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/selector.js'] });
}

async function captureBitmap(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return createImageBitmap(await (await fetch(dataUrl)).blob());
}

async function finishCapture(canvas, tab, s, engine) {
  const blob = await encodeCanvas(canvas, s);
  await runSearch({
    tab,
    s,
    engineIds: resolveEngineIds(s, engine),
    getBlob: async () => blob,
    raw: true
  });
}

async function searchVisible(tab, engine) {
  assertCapturable(tab);
  const s = await getSettings();
  const bmp = await captureBitmap(tab);
  const canvas = cropToCanvas(bmp, 0, 0, bmp.width, bmp.height, s.maxDimension, s.format === 'jpeg');
  bmp.close?.();
  await finishCapture(canvas, tab, s, engine);
}

async function handleAreaSelected(msg, tab) {
  try {
    const s = await getSettings();
    await sleep(60);
    const bmp = await captureBitmap(tab);
    const k = bmp.width / msg.vw;
    const sx = clamp(Math.round(msg.rect.x * k), 0, bmp.width - 1);
    const sy = clamp(Math.round(msg.rect.y * k), 0, bmp.height - 1);
    const sw = clamp(Math.round(msg.rect.w * k), 1, bmp.width - sx);
    const sh = clamp(Math.round(msg.rect.h * k), 1, bmp.height - sy);
    const canvas = cropToCanvas(bmp, sx, sy, sw, sh, s.maxDimension, s.format === 'jpeg');
    bmp.close?.();
    await finishCapture(canvas, tab, s);
  } catch (e) {
    toast(tab?.id, e.message || String(e), 'error');
  }
}

async function searchFullPage(tab, engine) {
  assertCapturable(tab);
  const s = await getSettings();
  const inPage = async (func, args = []) =>
    (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }))[0]?.result;

  const info = await inPage(() => {
    const de = document.documentElement;
    const total = Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0);
    window.__lencPrev = { x: window.scrollX, y: window.scrollY, behavior: de.style.scrollBehavior, hidden: [] };
    de.style.scrollBehavior = 'auto';
    return { total, vh: window.innerHeight, vw: window.innerWidth };
  });
  if (!info) throw new Error("Couldn't read this page.");

  chrome.action.setBadgeBackgroundColor({ color: '#3b5bfd' });
  chrome.action.setBadgeText({ text: '…' });

  const maxH = Math.min(info.total, s.fullPageMaxHeight);
  const frames = Math.max(1, Math.ceil(maxH / info.vh));
  let canvas = null;
  let ctx = null;
  let outPerCss = 1;
  let k = 1;

  try {
    for (let i = 0; i < frames; i++) {
      const wantY = Math.min(i * info.vh, Math.max(0, maxH - info.vh));
      const actualY = await inPage(
        (y, hideFixed) => {
          if (hideFixed && !window.__lencPrev.didHide) {
            window.__lencPrev.didHide = true;
            for (const el of document.querySelectorAll('body *')) {
              const pos = getComputedStyle(el).position;
              if (pos === 'fixed' || pos === 'sticky') {
                window.__lencPrev.hidden.push([el, el.style.visibility]);
                el.style.visibility = 'hidden';
              }
            }
          }
          window.scrollTo(0, y);
          return window.scrollY;
        },
        [wantY, i > 0]
      );
      await sleep(i === 0 ? 200 : 650);
      const bmp = await captureBitmap(tab);

      if (!canvas) {
        k = bmp.width / info.vw;
        outPerCss = Math.min(1, k);
        canvas = new OffscreenCanvas(Math.round(info.vw * outPerCss), Math.round(maxH * outPerCss));
        ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingQuality = 'high';
      }
      ctx.drawImage(bmp, 0, actualY * outPerCss, canvas.width, (bmp.height * outPerCss) / k);
      bmp.close?.();
    }
  } finally {
    await inPage(() => {
      const p = window.__lencPrev;
      if (!p) return;
      for (const [el, v] of p.hidden) el.style.visibility = v;
      document.documentElement.style.scrollBehavior = p.behavior;
      window.scrollTo(p.x, p.y);
      delete window.__lencPrev;
    }).catch(() => {});
    chrome.action.setBadgeText({ text: '' });
  }

  await finishCapture(canvas, tab, s, engine);
}

async function toast(tabId, text, kind = 'info') {
  if (tabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [text, kind],
      func: (msg, tone) => {
        const ID = '__lenc_toast__';
        document.getElementById(ID)?.remove();
        clearTimeout(window.__lencToastTimer);
        const el = document.createElement('div');
        el.id = ID;
        el.textContent = msg;
        el.style.cssText =
          'all:initial;position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;' +
          'padding:12px 18px;border-radius:12px;font:600 14px/1.35 system-ui,sans-serif;color:#fff;max-width:80vw;' +
          'box-shadow:0 10px 30px rgba(0,0,0,.35);background:' + (tone === 'error' ? '#d63b4f' : '#14213d');
        document.documentElement.appendChild(el);
        window.__lencToastTimer = setTimeout(() => el.remove(), 5000);
      }
    });
  } catch {}
}
