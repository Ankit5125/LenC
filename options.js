import { DEFAULTS, getSettings, saveSettings, resetSettings } from './settings.js';
import { BUILTIN_ENGINES, enabledEngines, effectiveDefault } from './engines.js';
import { applyTheme } from './theme.js';

const $ = (id) => document.getElementById(id);
const ACCENTS = ['#3b5bfd', '#0ea5e9', '#14b8a6', '#16a34a', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'];
let s;
let toastTimer;

function flash(text = 'Saved') {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
}

async function update(patch) {
  Object.assign(s, patch);
  await saveSettings(patch);
  applyTheme(s);
  flash();
}

function renderDefaultSelect() {
  const sel = $('defaultEngine');
  const engines = enabledEngines(s);
  sel.textContent = '';
  for (const e of engines) sel.append(new Option(e.name, e.id));
  if (engines.length > 1) sel.append(new Option('All enabled engines', 'all'));
  sel.value = effectiveDefault(s);
}

function renderEngineList() {
  const list = $('engineList');
  list.textContent = '';
  for (const e of BUILTIN_ENGINES) {
    const row = document.createElement('label');
    row.className = 'engine';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = s.enabledEngines.includes(e.id);
    cb.addEventListener('change', async () => {
      const next = BUILTIN_ENGINES.map((x) => x.id).filter((id) => (id === e.id ? cb.checked : s.enabledEngines.includes(id)));
      const customOn = !!s.customEngine.enabled && enabledEngines(s).some((x) => x.custom);
      if (!next.length && !customOn) {
        cb.checked = true;
        return flash('Keep at least one engine on');
      }
      await update({ enabledEngines: next });
      renderDefaultSelect();
    });
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = e.name;
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = e.note;
    row.append(cb, name, note);
    list.append(row);
  }
}

function validateCustom() {
  const c = s.customEngine;
  const note = $('customNote');
  note.className = 'note';
  if (!c.template) { note.textContent = ''; return; }
  if (!/^https?:\/\//i.test(c.template)) { note.textContent = 'The address must start with http:// or https://'; note.classList.add('bad'); return; }
  if (!c.template.includes('{url}')) { note.textContent = 'Add {url} where the image address should go.'; note.classList.add('bad'); return; }
  if (!c.name) { note.textContent = 'Give the engine a name.'; note.classList.add('bad'); return; }
  note.textContent = c.enabled ? 'Ready. It now appears in the popup and the right-click menu.' : 'Looks good. Tick "Enable this engine" to use it.';
}

function bindCustom() {
  const c = s.customEngine;
  $('customName').value = c.name;
  $('customTemplate').value = c.template;
  $('customEnabled').checked = c.enabled;
  if (c.name || c.template) $('customBox').open = true;
  validateCustom();

  let timer;
  const push = () => {
    s.customEngine = { name: $('customName').value.trim(), template: $('customTemplate').value.trim(), enabled: $('customEnabled').checked };
    validateCustom();
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await update({ customEngine: s.customEngine });
      renderDefaultSelect();
    }, 350);
  };
  ['customName', 'customTemplate', 'customEnabled'].forEach((id) => $(id).addEventListener('input', push));
}

function bindControls() {
  document.querySelectorAll('input[type="checkbox"][data-key]').forEach((el) => {
    el.checked = !!s[el.dataset.key];
    el.addEventListener('change', () => update({ [el.dataset.key]: el.checked }));
  });
  document.querySelectorAll('select[data-key]').forEach((el) => {
    el.value = String(s[el.dataset.key]);
    el.addEventListener('change', () => update({ [el.dataset.key]: el.dataset.type === 'number' ? Number(el.value) : el.value }));
  });
  document.querySelectorAll('.seg[data-key]').forEach((seg) => {
    const key = seg.dataset.key;
    const paint = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === s[key])));
    paint();
    seg.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      await update({ [key]: b.dataset.value });
      paint();
    });
  });

  $('defaultEngine').addEventListener('change', (e) => update({ defaultEngine: e.target.value }));

  const q = $('quality');
  const paintQ = () => ($('qualityOut').textContent = Math.round(s.quality * 100) + '%');
  q.value = s.quality;
  paintQ();
  q.addEventListener('input', () => { s.quality = Number(q.value); paintQ(); });
  q.addEventListener('change', () => update({ quality: Number(q.value) }));
}

function renderSwatches() {
  const wrap = $('swatches');
  wrap.textContent = '';
  const paint = () => wrap.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === s.accent)));
  for (const color of ACCENTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.color = color;
    b.style.background = color;
    b.title = color;
    b.setAttribute('aria-label', 'Accent ' + color);
    b.addEventListener('click', async () => { await update({ accent: color }); paint(); picker.value = color; });
    wrap.append(b);
  }
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = s.accent;
  picker.title = 'Custom colour';
  picker.setAttribute('aria-label', 'Custom accent colour');
  picker.addEventListener('input', () => { s.accent = picker.value; applyTheme(s); paint(); });
  picker.addEventListener('change', () => update({ accent: picker.value }));
  wrap.append(picker);
  paint();
}

async function renderShortcuts() {
  const ul = $('keys');
  ul.textContent = '';
  const cmds = (await chrome.commands.getAll()).filter((c) => c.name !== '_execute_action');
  for (const c of cmds) {
    const li = document.createElement('li');
    const d = document.createElement('span');
    d.textContent = c.description;
    const k = document.createElement('kbd');
    k.textContent = c.shortcut || 'Not set';
    if (!c.shortcut) k.className = 'none';
    li.append(d, k);
    ul.append(li);
  }
}

(async () => {
  s = await getSettings();
  applyTheme(s);
  renderEngineList();
  renderDefaultSelect();
  bindCustom();
  bindControls();
  renderSwatches();
  renderShortcuts();

  $('editKeys').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  $('reset').addEventListener('click', async () => {
    if (!confirm('Reset every LenC setting to its default?')) return;
    await resetSettings();
    location.reload();
  });
  window.addEventListener('focus', renderShortcuts);
})();
