const REQUEST_TIMEOUT_MS = 15000;
const MIN_REQUEST_GAP_MS = 120;
const BASE_RETRY_DELAY_MS = 600;
const MAX_CACHE_ENTRIES = 4000;
const COOLDOWN_BASE_MS = 15000;
const COOLDOWN_MAX_MS = 300000;

const TRANSLATE_ENDPOINTS = [
  {
    name: 'translate.googleapis.com',
    buildUrl: (text, sl, tl) =>
      `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&dj=1&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`,
    parse: (data) => {
      if (!data || !Array.isArray(data.sentences)) return '';
      return data.sentences
        .map(sentence => (sentence && typeof sentence.trans === 'string' ? sentence.trans : ''))
        .join('');
    }
  },
  {
    name: 'translate.google.com',
    buildUrl: (text, sl, tl) =>
      `https://translate.google.com/translate_a/single?client=gtx&dt=t&dj=1&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`,
    parse: (data) => {
      if (!data || !Array.isArray(data.sentences)) return '';
      return data.sentences
        .map(sentence => (sentence && typeof sentence.trans === 'string' ? sentence.trans : ''))
        .join('');
    }
  },
  {
    name: 'clients5.google.com',
    buildUrl: (text, sl, tl) =>
      `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`,
    parse: (data) => collectStrings(data).join('')
  }
];

const translationCache = new Map();
let requestChain = Promise.resolve();
let lastRequestAt = 0;
let cooldownUntil = 0;
let cooldownStep = 0;
let endpointStart = 0;

console.log(`[CRUNCHY-EXT BG] Service worker listo (v${chrome.runtime.getManifest().version})`);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'TRANSLATE') {
    const sourceLanguage = normalizeLanguageCode(request.sl || request.sourceLang, 'en');
    const targetLanguage = normalizeLanguageCode(request.tl || request.targetLang, 'es');
    translate(request.text, sourceLanguage, targetLanguage)
      .then(text => {
        sendResponse({ success: true, text });
      })
      .catch(error => {
        console.warn('[CRUNCHY-EXT BG] Translation error:', error.message, error.detail || '');
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

async function translate(text, sourceLanguage, targetLanguage) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return '';

  const cacheKey = `${sourceLanguage}\u0000${targetLanguage}\u0000${cleanText}`;
  const cached = translationCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const cooldownLeft = cooldownUntil - Date.now();
  if (cooldownLeft > 0) {
    throw new Error(`Servicio de traducción saturado; reintento en ${Math.ceil(cooldownLeft / 1000)}s`);
  }

  let lastError = null;
  let rateLimited = false;
  const endpoints = TRANSLATE_ENDPOINTS.map((_, offset) =>
    TRANSLATE_ENDPOINTS[(endpointStart + offset) % TRANSLATE_ENDPOINTS.length]);

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    try {
      const translated = await scheduleRequest(() => requestTranslation(endpoint, cleanText, sourceLanguage, targetLanguage));
      if (!translated) {
        const error = new Error('Respuesta de traducción vacía');
        error.detail = `${endpoint.name} devolvió una traducción vacía`;
        throw error;
      }
      rememberTranslation(cacheKey, translated);
      endpointStart = TRANSLATE_ENDPOINTS.indexOf(endpoint);
      cooldownUntil = 0;
      cooldownStep = 0;
      return translated;
    } catch (error) {
      lastError = error;
      if (isRateLimit(error)) rateLimited = true;
      if (error.fatal) break;
      if (index < endpoints.length - 1) {
        await delay(BASE_RETRY_DELAY_MS);
      }
    }
  }

  if (rateLimited) startCooldown();
  throw lastError || new Error('No se pudo traducir el texto');
}

function isRateLimit(error) {
  return error.html === true || error.status === 429 || error.status === 403 || error.status === 503;
}

function startCooldown() {
  cooldownStep += 1;
  const wait = Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** (cooldownStep - 1));
  cooldownUntil = Date.now() + wait;
  console.warn(`[CRUNCHY-EXT BG] Límite de uso alcanzado. Pausando ${Math.round(wait / 1000)}s para no empeorarlo.`);
}

async function requestTranslation(endpoint, text, sourceLanguage, targetLanguage) {
  const data = await fetchJson(endpoint.buildUrl(text, sourceLanguage, targetLanguage));
  return String(endpoint.parse(data) || '').trim();
}

function scheduleRequest(task) {
  const run = requestChain.then(async () => {
    const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await delay(wait);
    lastRequestAt = Date.now();
    return task();
  });
  requestChain = run.then(() => undefined, () => undefined);
  return run;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
  } catch (error) {
    const failure = new Error(error.name === 'AbortError' ? 'Tiempo de espera agotado' : error.message);
    failure.detail = url;
    throw failure;
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text();
  const contentType = response.headers.get('Content-Type') || '';
  const isHtml = contentType.includes('html') || body.trimStart().startsWith('<');

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    error.detail = `${contentType} | ${body.slice(0, 200)}`;
    error.html = isHtml;
    error.fatal = !isHtml && response.status >= 400 && response.status < 500 && response.status !== 429;
    throw error;
  }

  try {
    return JSON.parse(body);
  } catch (parseError) {
    const error = new Error(`HTTP ${response.status}: respuesta no JSON`);
    error.status = response.status;
    error.detail = `${contentType} | ${body.slice(0, 200)}`;
    error.html = isHtml;
    throw error;
  }
}

function rememberTranslation(cacheKey, text) {
  if (translationCache.size >= MAX_CACHE_ENTRIES) {
    translationCache.delete(translationCache.keys().next().value);
  }
  translationCache.set(cacheKey, text);
}

function collectStrings(value) {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap(collectStrings);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeLanguageCode(language, fallback) {
  if (typeof language !== 'string' || !language.trim()) return fallback;

  const normalized = language.trim().replace('_', '-');
  const lowerCode = normalized.toLowerCase();

  if (lowerCode === 'zh-cn') return 'zh-CN';
  if (lowerCode === 'zh-tw') return 'zh-TW';
  return normalized.split('-')[0].toLowerCase();
}
