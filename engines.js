const enc = encodeURIComponent;

export const BUILTIN_ENGINES = [
  {
    id: 'google',
    name: 'Google Lens',
    short: 'Google',
    note: 'Best all-round results',
    byUrl: (u) => `https://lens.google.com/uploadbyurl?url=${enc(u)}`,
    upload: {
      action: () => `https://lens.google.com/v3/upload?hl=en&re=df&st=${Date.now()}&ep=gisbubb`,
      field: 'encoded_image'
    }
  },
  {
    id: 'bing',
    name: 'Bing Visual Search',
    short: 'Bing',
    note: 'Good for products and landmarks',
    byUrl: (u) => `https://www.bing.com/images/search?view=detailv2&iss=sbi&FORM=SBIVSP&sbisrc=UrlPaste&q=imgurl:${enc(u)}`,
    upload: {
      action: 'https://www.bing.com/images/search?view=detailv2&iss=sbiupload&FORM=SBIHMP&sbisrc=ImgDropper',
      field: 'imageBin',
      base64: true
    }
  },
  {
    id: 'yandex',
    name: 'Yandex Images',
    short: 'Yandex',
    note: 'Strong at faces and similar photos',
    byUrl: (u) => `https://yandex.com/images/search?rpt=imageview&url=${enc(u)}`,
    upload: {
      action: 'https://yandex.com/images/search?rpt=imageview',
      field: 'upfile'
    }
  },
  {
    id: 'tineye',
    name: 'TinEye',
    short: 'TinEye',
    note: 'Finds the original source of an image',
    byUrl: (u) => `https://tineye.com/search?url=${enc(u)}`,
    upload: {
      action: 'https://tineye.com/search',
      field: 'image'
    }
  }
];

function customEngineFrom(settings) {
  const c = settings.customEngine || {};
  const name = (c.name || '').trim();
  const template = (c.template || '').trim();
  if (!c.enabled || !name || !/^https?:\/\//i.test(template) || !template.includes('{url}')) return null;
  return {
    id: 'custom',
    name,
    short: name,
    note: 'Custom engine (image URLs only)',
    custom: true,
    byUrl: (u) => template.split('{url}').join(enc(u)),
    upload: null
  };
}

export function getEngines(settings) {
  const custom = customEngineFrom(settings);
  return custom ? [...BUILTIN_ENGINES, custom] : [...BUILTIN_ENGINES];
}

export function enabledEngines(settings) {
  const all = getEngines(settings);
  const on = all.filter((e) => e.custom || (settings.enabledEngines || []).includes(e.id));
  return on.length ? on : [BUILTIN_ENGINES[0]];
}

export function effectiveDefault(settings) {
  const ids = enabledEngines(settings).map((e) => e.id);
  if (settings.defaultEngine === 'all' && ids.length > 1) return 'all';
  if (ids.includes(settings.defaultEngine)) return settings.defaultEngine;
  return ids[0];
}

export function resolveEngineIds(settings, requested) {
  const ids = enabledEngines(settings).map((e) => e.id);
  if (requested === 'all') return ids;
  if (requested && ids.includes(requested)) return [requested];
  const d = effectiveDefault(settings);
  return d === 'all' ? ids : [d];
}
