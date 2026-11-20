(() => {
  if (window.__lencSelectorActive) return;
  window.__lencSelectorActive = true;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .layer{position:fixed;inset:0;cursor:crosshair;background:rgba(12,18,38,.38);user-select:none;-webkit-user-select:none;touch-action:none}
      .layer.drawing{background:transparent}
      .hint{position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:999px;
        background:#10172a;color:#fff;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none;white-space:nowrap}
      .hint kbd{font:inherit;background:rgba(255,255,255,.16);padding:2px 7px;border-radius:6px;margin:0 2px}
      .box{position:fixed;display:none;box-sizing:border-box;border:2px solid var(--accent,#3b5bfd);
        box-shadow:0 0 0 100vmax rgba(12,18,38,.5);pointer-events:none}
      .box i{position:absolute;width:10px;height:10px;background:#fff;border:2px solid var(--accent,#3b5bfd);border-radius:2px}
      .box i:nth-child(1){left:-6px;top:-6px}.box i:nth-child(2){right:-6px;top:-6px}
      .box i:nth-child(3){left:-6px;bottom:-6px}.box i:nth-child(4){right:-6px;bottom:-6px}
      .size{position:absolute;left:0;top:100%;margin-top:8px;padding:3px 8px;border-radius:6px;background:#10172a;color:#fff;
        font:600 12px/1.2 system-ui,sans-serif;white-space:nowrap}
    </style>
    <div class="layer">
      <div class="hint">Drag to select an area <kbd>Esc</kbd> to cancel</div>
      <div class="box"><i></i><i></i><i></i><i></i><span class="size"></span></div>
    </div>`;
  document.documentElement.appendChild(host);

  const layer = root.querySelector('.layer');
  const box = root.querySelector('.box');
  const sizeLabel = root.querySelector('.size');
  let start = null;
  let rect = null;

  try {
    chrome.storage.sync.get('accent', (r) => {
      if (r && r.accent) host.style.setProperty('--accent', r.accent);
    });
  } catch (_) {}

  function close() {
    window.removeEventListener('keydown', onKey, true);
    host.remove();
    window.__lencSelectorActive = false;
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function draw(x, y) {
    const left = Math.min(start.x, x);
    const top = Math.min(start.y, y);
    const w = Math.abs(x - start.x);
    const h = Math.abs(y - start.y);
    rect = { x: left, y: top, w, h };
    Object.assign(box.style, { display: 'block', left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
    sizeLabel.textContent = Math.round(w) + ' × ' + Math.round(h);
  }

  layer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY };
    layer.classList.add('drawing');
    root.querySelector('.hint').style.display = 'none';
    draw(e.clientX, e.clientY);
  });

  layer.addEventListener('pointermove', (e) => {
    if (start) draw(e.clientX, e.clientY);
  });

  layer.addEventListener('pointerup', (e) => {
    if (!start) return;
    draw(e.clientX, e.clientY);
    const finalRect = rect;
    start = null;
    if (finalRect.w < 8 || finalRect.h < 8) {
      layer.classList.remove('drawing');
      box.style.display = 'none';
      root.querySelector('.hint').style.display = '';
      return;
    }
    close();
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'area-selected',
            rect: finalRect,
            vw: window.innerWidth,
            vh: window.innerHeight,
            dpr: window.devicePixelRatio
          });
        }, 80)
      )
    );
  });

  layer.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  layer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    close();
  });
  window.addEventListener('keydown', onKey, true);
})();
