export const DEFAULTS = {
  defaultEngine: 'google',
  enabledEngines: ['google', 'bing', 'yandex', 'tineye'],
  customEngine: { enabled: false, name: '', template: '' },
  imageMethod: 'url',
  contextSubmenu: true,
  contextAreaItem: true,
  openInBackground: false,
  openNextToTab: true,
  format: 'jpeg',
  quality: 0.92,
  maxDimension: 4096,
  fullPageMaxHeight: 8000,
  theme: 'system',
  accent: '#3b5bfd'
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(null);
  const s = { ...DEFAULTS, ...stored };
  s.customEngine = { ...DEFAULTS.customEngine, ...(stored.customEngine || {}) };
  return s;
}

export async function saveSettings(patch) {
  await chrome.storage.sync.set(patch);
}

export async function resetSettings() {
  await chrome.storage.sync.clear();
}
