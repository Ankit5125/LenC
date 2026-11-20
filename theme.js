export function applyTheme(settings) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme || 'system';
  root.style.setProperty('--accent', settings.accent);
  root.style.setProperty('--on-accent', readableOn(settings.accent));
}

function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#10172a' : '#ffffff';
}
