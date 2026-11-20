import { getSettings } from './settings.js';
import { getEngines } from './engines.js';
import { applyTheme } from './theme.js';

const $ = (id) => document.getElementById(id);

function fail(message) {
  $('card').classList.add('err');
  $('title').textContent = "Couldn't send the image";
  $('msg').textContent = message;
  document.title = 'LenC error';
}

(async () => {
  const settings = await getSettings();
  applyTheme(settings);

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const engine = getEngines(settings).find((e) => e.id === params.get('engine'));
  if (!engine || !engine.upload) return fail('That search engine does not support image uploads.');

  $('title').textContent = `Sending your image to ${engine.name}…`;
  document.title = `Searching on ${engine.short}…`;

  const key = 'img:' + id;
  const data = (await chrome.storage.session.get(key))[key];
  if (!data) return fail('The image has expired. Start the search again.');

  const up = engine.upload;
  const form = document.createElement('form');
  form.method = 'POST';
  form.enctype = 'multipart/form-data';
  form.acceptCharset = 'utf-8';
  form.action = typeof up.action === 'function' ? up.action() : up.action;
  form.style.display = 'none';

  if (up.base64) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = up.field;
    input.value = data.b64;
    form.append(input);
  } else {
    const bytes = Uint8Array.from(atob(data.b64), (c) => c.charCodeAt(0));
    const ext = data.mime === 'image/png' ? 'png' : 'jpg';
    const file = new File([bytes], `image.${ext}`, { type: data.mime });
    const input = document.createElement('input');
    input.type = 'file';
    input.name = up.field;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    form.append(input);
  }

  document.body.append(form);
  form.submit();
})().catch((e) => fail(e?.message || String(e)));
