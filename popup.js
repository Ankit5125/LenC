import { getSettings, saveSettings } from './settings.js';
import { enabledEngines, effectiveDefault } from './engines.js';
import { applyTheme } from './theme.js';

const $ = (id) => document.getElementById(id);
let settings;

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + kind;
}

async function send(msg, busyText) {
  setStatus(busyText || 'Working…', 'busy');
  let res;
  try {
    res = await chrome.runtime.sendMessage({ ...msg, engine: effectiveDefault(settings) });
  } catch (e) {
    res = { ok: false, error: e.message };
  }
  if (res && res.ok) {
    window.close();
  } else {
    setStatus((res && res.error) || 'Something went wrong. Try again.', 'error');
  }
}

function renderChips() {
  const engines = enabledEngines(settings);
  const current = effectiveDefault(settings);
  const items = engines.map((e) => ({ id: e.id, label: e.short }));
  if (engines.length > 1) items.push({ id: 'all', label: 'All' });

  const wrap = $('chips');
  wrap.textContent = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(it.id === current));
    b.textContent = it.label;
    b.addEventListener('click', async () => {
      settings.defaultEngine = it.id;
      await saveSettings({ defaultEngine: it.id });
      renderChips();
    });
    wrap.append(b);
  }
}

async function showShortcuts() {
  try {
    const cmds = await chrome.commands.getAll();
    document.querySelectorAll('kbd[data-cmd]').forEach((k) => {
      k.textContent = cmds.find((c) => c.name === k.dataset.cmd)?.shortcut || '';
    });
  } catch (_) {}
}

function sendFile(file) {
  if (!file || !file.type.startsWith('image/')) return setStatus('That file is not an image.', 'error');
  if (file.size > 25 * 1024 * 1024) return setStatus('Image is larger than 25 MB.', 'error');
  const reader = new FileReader();
  reader.onload = () => send({ type: 'search-file', dataUrl: reader.result }, 'Sending image…');
  reader.onerror = () => setStatus("Couldn't read that file.", 'error');
  reader.readAsDataURL(file);
}

(async () => {
  settings = await getSettings();
  applyTheme(settings);
  renderChips();
  showShortcuts();

  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.action;
      const text = { 'start-area': 'Starting…', 'search-visible': 'Capturing…', 'search-fullpage': 'Capturing the full page…' }[type];
      send({ type }, text);
    });
  });

  $('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  const drop = $('drop');
  const file = $('file');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      file.click();
    }
  });
  file.addEventListener('change', () => sendFile(file.files[0]));
  ['dragenter', 'dragover'].forEach((t) =>
    drop.addEventListener(t, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    })
  );
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    sendFile(e.dataTransfer.files[0]);
  });

  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      sendFile(item.getAsFile());
    }
  });

  $('urlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('urlInput').value.trim();
    if (!url) return setStatus('Paste an image address first.', 'error');
    send({ type: 'search-url', url }, 'Searching…');
  });
})();
