function debugLog(...args) {
  console.log('[CRUNCHY-EXT]', ...args);
}

debugLog(`Content script v${chrome.runtime.getManifest().version} inyectado`);

let currentMode = 'auto';
let syncOffset = 0;
let localSubtitles = [];
let remoteSubtitles = [];
let videoElement = null;
let subsContainer = null;
let subsContainerStage = null;
let timeUpdateListener = null;
let subtitleTracks = {};
let currentSourceLang = 'en-US';
let currentTargetLang = 'es';
let activeSubtitleUrl = null;
let subtitleLoadId = 0;
let subtitlePlayRes = { x: 384, y: 288 };
let verticalPosition = 10;
let signSizeScale = 70;
let renderedSubtitleEntries = [];

let syncOffsets = {};
let legacySyncOffset = 0;
let localFileName = '';
let syncOverlayRoot = null;
let syncPanel = null;
let syncPanelValue = null;
let syncToast = null;
let syncToastTimer = null;
let syncHideTimer = null;
let syncPersistTimer = null;
let syncOverlayBoundParent = null;
let pendingSyncPersists = new Map();

const MAX_SYNC_OFFSET = 120;
const SYNC_STEP_FINE = 0.1;
const SYNC_STEP_COARSE = 1;
const SYNC_PERSIST_DEBOUNCE_MS = 300;
const SYNC_PANEL_HIDE_MS = 2500;
const SYNC_TOAST_MS = 1600;

let cachedTranslations = new Map();
let failedTranslations = new Map();
let preloadingSet = new Set();
let translationTimeout = null;
let animationFrameId = null;
let translationGeneration = 0;

const LANGUAGE_NAMES = {
  af: 'Afrikáans',
  ar: 'Árabe',
  bg: 'Búlgaro',
  ca: 'Catalán',
  cs: 'Checo',
  da: 'Danés',
  de: 'Alemán',
  el: 'Griego',
  en: 'Inglés',
  es: 'Español',
  et: 'Estonio',
  fa: 'Persa',
  fi: 'Finés',
  fr: 'Francés',
  he: 'Hebreo',
  hi: 'Hindi',
  hu: 'Húngaro',
  id: 'Indonesio',
  it: 'Italiano',
  ja: 'Japonés',
  ko: 'Coreano',
  lt: 'Lituano',
  lv: 'Letón',
  ms: 'Malayo',
  nl: 'Neerlandés',
  no: 'Noruego',
  pl: 'Polaco',
  pt: 'Portugués',
  ro: 'Rumano',
  ru: 'Ruso',
  sk: 'Eslovaco',
  sl: 'Esloveno',
  sr: 'Serbio',
  sv: 'Sueco',
  sw: 'Suajili',
  ta: 'Tamil',
  th: 'Tailandés',
  tr: 'Turco',
  uk: 'Ucraniano',
  vi: 'Vietnamita',
  zh: 'Chino'
};

const REGION_NAMES = {
  '419': 'Latinoamérica',
  BR: 'Brasil',
  CN: 'China',
  ES: 'España',
  GB: 'Reino Unido',
  JP: 'Japón',
  KR: 'Corea',
  PT: 'Portugal',
  TW: 'Taiwán',
  US: 'EE. UU.'
};

function getLanguageLabel(code) {
  const parts = String(code).replace('_', '-').split('-');
  const language = parts[0].toLowerCase();
  const languageName = LANGUAGE_NAMES[language] || code;
  const region = parts.slice(1).join('-').toUpperCase();
  const regionName = REGION_NAMES[region] || region;
  return region ? `${languageName} (${regionName})` : languageName;
}

function getTranslationLanguageCode(code) {
  const normalized = String(code || '').replace('_', '-');
  const lowerCode = normalized.toLowerCase();
  if (lowerCode === 'zh-cn') return 'zh-CN';
  if (lowerCode === 'zh-tw') return 'zh-TW';
  return normalized.split('-')[0].toLowerCase();
}

function getBaseLanguageCode(code) {
  return String(code || '').replace('_', '-').split('-')[0].toLowerCase();
}

function invalidateTranslations() {
  cachedTranslations.clear();
  failedTranslations.clear();
  preloadingSet.clear();
  translationGeneration += 1;
  lastRenderedHash = '';
  lastRenderedLayoutHash = '';
  if (translationTimeout) {
    clearTimeout(translationTimeout);
    translationTimeout = null;
  }
}

function isTranslationBackingOff(cacheKey) {
  const failure = failedTranslations.get(cacheKey);
  if (!failure) return false;
  if (Date.now() >= failure.until) {
    failedTranslations.delete(cacheKey);
    return false;
  }
  return true;
}

function registerTranslationFailure(cacheKey) {
  const attempts = ((failedTranslations.get(cacheKey) || {}).attempts || 0) + 1;
  const wait = Math.min(60000, 2000 * 2 ** (attempts - 1));
  failedTranslations.set(cacheKey, { attempts, until: Date.now() + wait });
  return wait;
}

function resolveSubtitleTrackCode(preferredCode) {
  const codes = Object.keys(subtitleTracks);
  if (codes.length === 0) return null;
  if (preferredCode && subtitleTracks[preferredCode]) return preferredCode;

  const preferredBase = getBaseLanguageCode(preferredCode);
  const baseMatch = codes.find(code => getBaseLanguageCode(code) === preferredBase);
  if (baseMatch) return baseMatch;

  return codes.find(code => getBaseLanguageCode(code) === 'en') || codes[0];
}

function getAvailableLanguages() {
  return Object.keys(subtitleTracks)
    .map(code => ({ code, label: getLanguageLabel(code) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

function publishAvailableLanguages(sourceCode) {
  const availableLangs = getAvailableLanguages();
  const settings = { availableLangs };
  if (sourceCode) settings.sourceLang = sourceCode;
  chrome.storage.local.set(settings);
  return availableLangs;
}

function setSubtitleTracks(subtitles) {
  subtitleTracks = Object.fromEntries(
    Object.entries(subtitles || {}).filter(([, track]) => track && typeof track.url === 'string' && track.url)
  );

  if (Object.keys(subtitleTracks).length === 0) return null;

  activeSubtitleUrl = null;

  const resolvedCode = resolveSubtitleTrackCode(currentSourceLang);
  if (resolvedCode && resolvedCode !== currentSourceLang) {
    currentSourceLang = resolvedCode;
  }
  publishAvailableLanguages(currentSourceLang);
  refreshSyncOffset();

  return resolvedCode;
}

async function loadSelectedSubtitle() {
  const trackCode = resolveSubtitleTrackCode(currentSourceLang);
  const track = trackCode ? subtitleTracks[trackCode] : null;
  if (!track || !track.url) return;

  if (trackCode !== currentSourceLang) {
    currentSourceLang = trackCode;
    chrome.storage.local.set({ sourceLang: currentSourceLang });
    refreshSyncOffset();
  }

  if (activeSubtitleUrl === track.url && remoteSubtitles.length > 0) {
    return;
  }

  const loadId = ++subtitleLoadId;
  activeSubtitleUrl = track.url;
  try {
    const res = await fetch(track.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (loadId !== subtitleLoadId) return;
    debugLog(`Subtitle file downloaded (${currentSourceLang}). Length:`, text.length);
    parseSubtitles(text, true);
    if (usesOfficialTrack()) renderLocalSubtitles();
  } catch (e) {
    if (loadId === subtitleLoadId) {
      activeSubtitleUrl = null;
      debugLog('Failed to fetch subtitle:', e);
    }
  }
}

function applyLanguageSettings(settings) {
  const sourceChanged = settings.sourceLang && settings.sourceLang !== currentSourceLang;
  const targetChanged = settings.targetLang && settings.targetLang !== currentTargetLang;

  if (settings.sourceLang) currentSourceLang = settings.sourceLang;
  if (settings.targetLang) currentTargetLang = settings.targetLang;

  if (sourceChanged) {
    invalidateTranslations();
    if (usesOfficialTrack()) {
      localSubtitles = [];
      clearSubtitles();
    }
    loadSelectedSubtitle();
  } else if (targetChanged) {
    invalidateTranslations();
    if (usesOfficialTrack()) renderLocalSubtitles();
  }

  refreshSyncOffset();
}

function init() {
  debugLog("init() started");

  subsContainer = document.getElementById('crunchy-subs-container');
  subsContainerStage = document.getElementById('crunchy-subs-stage');

  if (!subsContainer) {
    subsContainer = document.createElement('div');
    subsContainer.id = 'crunchy-subs-container';
  }

  if (!subsContainerStage) {
    subsContainerStage = document.createElement('div');
    subsContainerStage.id = 'crunchy-subs-stage';
    subsContainer.appendChild(subsContainerStage);
  }

  document.addEventListener('keydown', handleSyncKeydown, true);

  chrome.storage.local.get(['sourceLang', 'targetLang', 'syncOffsets', 'syncOffset', 'localFileName'], (res) => {
    loadSyncSettings(res);
    applyLanguageSettings(res);
    refreshSyncOffset();
  });

  const observer = new MutationObserver(() => {
    const currentVideo = document.querySelector('video');
    if (currentVideo && currentVideo.parentElement) {
      if (videoElement !== currentVideo || !document.getElementById('crunchy-subs-container')) {
        debugLog("Video element found/changed. Attaching subtitles container.");
        
        if (videoElement && timeUpdateListener) {
            videoElement.removeEventListener('timeupdate', timeUpdateListener);
        }
        
        videoElement = currentVideo;
        videoElement.parentElement.appendChild(subsContainer);
        ensureSyncOverlay();
        clearSubtitles();
        lastRenderedHash = '';
        lastRenderedLayoutHash = '';
        setupVideoListeners();
        
        chrome.storage.local.get(['subMode', 'syncOffset', 'syncOffsets', 'localFileName', 'localFileContent', 'subStyles', 'sourceLang', 'targetLang'], (res) => {
          if (res.subMode) currentMode = res.subMode;
          loadSyncSettings(res);
          if (res.sourceLang) currentSourceLang = res.sourceLang;
          if (res.targetLang) currentTargetLang = res.targetLang;
          refreshSyncOffset();
          if (res.subStyles) applyStyles(res.subStyles);
          if (res.localFileContent && currentMode === 'local') parseSubtitles(res.localFileContent);
          if (usesOfficialTrack() && Object.keys(subtitleTracks).length > 0) loadSelectedSubtitle();
          updateMode();
        });
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CR_STREAMS_DATA') {
    debugLog("Intercepted STREAMS DATA", event.data.data);
    handleStreamsData(event.data.data);
  }
});

async function handleStreamsData(data) {
  if (!data || !data.subtitles) return;
  const trackCode = setSubtitleTracks(data.subtitles);
  if (!trackCode) return;

  debugLog('Available subtitle languages:', Object.keys(subtitleTracks));
  await loadSelectedSubtitle();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debugLog("Message from popup:", request.action);
  if (request.action === 'MODE_CHANGED') {
    currentMode = request.mode;
    if (usesOfficialTrack() && remoteSubtitles.length > 0) {
      localSubtitles = remoteSubtitles;
      invalidateTranslations();
    }
    updateMode();
  } else if (request.action === 'OFFSET_CHANGED') {
    setSyncOffset(request.offset, { announce: true });
  } else if (request.action === 'NEW_SUBTITLES_LOADED') {
    if (request.fileName) localFileName = request.fileName;
    refreshSyncOffset();
    parseSubtitles(request.content);
    if (currentMode === 'local') {
      renderLocalSubtitles();
    }
  } else if (request.action === 'LANG_CHANGED') {
    applyLanguageSettings(request);
    chrome.storage.local.set({ sourceLang: currentSourceLang, targetLang: currentTargetLang });
    if (usesOfficialTrack()) renderLocalSubtitles();
  } else if (request.action === 'GET_AVAILABLE_LANGS') {
    sendResponse({ availableLangs: getAvailableLanguages() });
  } else if (request.action === 'STYLE_CHANGED') {
    applyStyles(request.styles);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.syncOffsets) {
    const next = changes.syncOffsets.newValue;
    syncOffsets = next && typeof next === 'object' ? next : {};
    refreshSyncOffset();
  }
  if (changes.localFileName && typeof changes.localFileName.newValue === 'string') {
    localFileName = changes.localFileName.newValue;
    refreshSyncOffset();
  }
});

function hexToRgba(hex, alpha) {
  let r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyStyles(styles) {
  if (!styles) return;
  let positionChanged = false;
  let signScaleChanged = false;

  if (styles.position !== undefined) {
    const parsedPosition = Number(styles.position);
    if (Number.isFinite(parsedPosition)) {
      positionChanged = verticalPosition !== parsedPosition;
      verticalPosition = Math.max(0, Math.min(90, parsedPosition));
    }
  }

  if (styles.signSizeScale !== undefined) {
    const parsedSignSize = Number(styles.signSizeScale);
    if (Number.isFinite(parsedSignSize)) {
      const clamped = Math.max(10, Math.min(400, parsedSignSize));
      signScaleChanged = clamped !== signSizeScale;
      signSizeScale = clamped;
    }
  }

  if (!subsContainer) return;
  if (styles.font) subsContainer.style.setProperty('--sub-font', styles.font);
  if (styles.color) subsContainer.style.setProperty('--sub-color', styles.color);
  if (styles.bg && styles.bgOpacity !== undefined) {
     const rgba = hexToRgba(styles.bg, styles.bgOpacity / 100);
     subsContainer.style.setProperty('--sub-bg', rgba);
  }
  
  if (styles.fontSize !== undefined) {
    subsContainer.style.setProperty('--sub-font-scale', styles.fontSize / 100);
  }
  
  if (styles.position !== undefined) {
     subsContainer.style.setProperty('--sub-position', verticalPosition + '%');
  }

  const outlineColor = styles.outline || '#000000';
  const outlineSize = styles.outlineSize !== undefined ? styles.outlineSize : '2';

   function buildOutline(color, size) {
     if (size === '0') return 'none';
     const s = size + 'px';
     const c = color;
     return [
       `-${s} 0 0 ${c}`,    `${s} 0 0 ${c}`,
       `0 -${s} 0 ${c}`,    `0 ${s} 0 ${c}`,
       `-${s} -${s} 0 ${c}`, `${s} -${s} 0 ${c}`,
       `-${s} ${s} 0 ${c}`,  `${s} ${s} 0 ${c}`,
       '0px 3px 4px rgba(0,0,0,0.8)'
     ].join(', ');
   }

   if (styles.outlineEnabled !== undefined) {
     if (styles.outlineEnabled) {
       subsContainer.style.setProperty('--sub-text-shadow', buildOutline(outlineColor, outlineSize));
     } else {
       subsContainer.style.setProperty('--sub-text-shadow', 'none');
     }
    } else {
      subsContainer.style.setProperty('--sub-text-shadow', buildOutline(outlineColor, outlineSize));
    }

  if (positionChanged || signScaleChanged) {
    lastRenderedHash = '';
    lastRenderedLayoutHash = '';
    clearSubtitles();
    if (isSubtitleModeActive() && localSubtitles.length > 0) {
      renderLocalSubtitles();
    }
  }
}

function usesOfficialTrack() {
  return currentMode === 'auto' || currentMode === 'original';
}

function isSubtitleModeActive() {
  return currentMode === 'local' || usesOfficialTrack();
}

function updateMode() {
  lastRenderedHash = '';
  lastRenderedLayoutHash = '';
  clearSubtitles();
  refreshSyncOffset();
  if (isSubtitleModeActive()) {
    document.body.classList.add('hide-native-subs');
    renderLocalSubtitles();
  } else {
    document.body.classList.remove('hide-native-subs');
    hideSyncPanel();
  }
}

function getSyncKey() {
  if (currentMode === 'local') return `file:${localFileName || ''}`;
  return `lang:${currentSourceLang || ''}`;
}

function normalizeSyncOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const clamped = Math.max(-MAX_SYNC_OFFSET, Math.min(MAX_SYNC_OFFSET, parsed));
  return Math.round(clamped * 100) / 100;
}

function formatSyncOffset(value) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const text = Math.abs(value).toFixed(2).replace(/\.?0+$/, '') || '0';
  return `${sign}${text} s`;
}

function describeSyncOffset(value) {
  if (Math.abs(value) < 0.001) return 'Subtítulos sincronizados';
  return `Subtítulos ${formatSyncOffset(value)} · ${value > 0 ? 'adelantados' : 'retrasados'}`;
}

function loadSyncSettings(result) {
  if (result.syncOffsets && typeof result.syncOffsets === 'object') {
    syncOffsets = result.syncOffsets;
  }
  if (typeof result.syncOffset === 'number') {
    legacySyncOffset = result.syncOffset;
  }
  if (typeof result.localFileName === 'string') {
    localFileName = result.localFileName;
  }
}

function resolveSyncOffsetForKey(key) {
  if (key && Object.prototype.hasOwnProperty.call(syncOffsets, key)) {
    return normalizeSyncOffset(syncOffsets[key]);
  }
  if (Object.keys(syncOffsets).length === 0) {
    return normalizeSyncOffset(legacySyncOffset);
  }
  return 0;
}

function refreshSyncOffset() {
  if (currentMode === 'off') return;

  const resolved = resolveSyncOffsetForKey(getSyncKey());
  updateSyncPanelValue(resolved);
  if (resolved === syncOffset) return;
  syncOffset = resolved;
  lastRenderedHash = '';
  lastRenderedLayoutHash = '';
  if (isSubtitleModeActive() && localSubtitles.length > 0) {
    renderLocalSubtitles();
  }
}

function scheduleSyncPersist(key, value) {
  pendingSyncPersists.set(key, value);
  if (syncPersistTimer) clearTimeout(syncPersistTimer);
  syncPersistTimer = setTimeout(flushSyncPersists, SYNC_PERSIST_DEBOUNCE_MS);
}

function flushSyncPersists() {
  syncPersistTimer = null;
  if (pendingSyncPersists.size === 0) return;

  const pending = new Map(pendingSyncPersists);
  pendingSyncPersists.clear();
  chrome.storage.local.get(['syncOffsets'], (res) => {
    const stored = res.syncOffsets && typeof res.syncOffsets === 'object' ? res.syncOffsets : {};
    pending.forEach((value, key) => { stored[key] = value; });
    chrome.storage.local.set({ syncOffsets: stored });
  });
}

function setSyncOffset(value, options = {}) {
  const { persist = false, announce = false } = options;
  const next = normalizeSyncOffset(value);

  if (persist) {
    const key = getSyncKey();
    syncOffsets[key] = next;
    scheduleSyncPersist(key, next);
  }

  if (next !== syncOffset) {
    syncOffset = next;
    lastRenderedHash = '';
    lastRenderedLayoutHash = '';
    if (isSubtitleModeActive() && localSubtitles.length > 0) {
      renderLocalSubtitles();
    }
  }

  updateSyncPanelValue();
  if (announce) showSyncToast(describeSyncOffset(next));
}

function adjustSyncOffset(delta) {
  setSyncOffset(syncOffset + delta, { persist: true, announce: true });
}

function isEditableTarget(target) {
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;
  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable === true;
}

function handleSyncKeydown(event) {
  if (!videoElement || currentMode === 'off') return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isEditableTarget(event.target)) return;

  const step = event.shiftKey ? SYNC_STEP_COARSE : SYNC_STEP_FINE;
  let delta = 0;
  if (event.code === 'Period') delta = step;
  else if (event.code === 'Comma') delta = -step;
  else return;

  event.preventDefault();
  event.stopPropagation();
  adjustSyncOffset(delta);
}

function ensureSyncOverlay() {
  if (!videoElement || !videoElement.parentElement) return;
  const parent = videoElement.parentElement;

  if (!syncOverlayRoot || !syncPanel) {
    syncOverlayRoot = document.createElement('div');
    syncOverlayRoot.id = 'crunchy-subs-sync-root';

    syncPanel = document.createElement('div');
    syncPanel.className = 'crunchy-sync-panel';

    const addButton = (label, title, action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'crunchy-sync-btn';
      button.textContent = label;
      button.title = title;
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        action();
        showSyncPanel();
      });
      syncPanel.appendChild(button);
    };

    addButton('-1 s', 'Retrasar los subtítulos 1 segundo', () => adjustSyncOffset(-SYNC_STEP_COARSE));
    addButton('-0.1 s', 'Retrasar los subtítulos 0,1 segundos', () => adjustSyncOffset(-SYNC_STEP_FINE));

    syncPanelValue = document.createElement('span');
    syncPanelValue.className = 'crunchy-sync-value';
    syncPanel.appendChild(syncPanelValue);

    addButton('+0.1 s', 'Adelantar los subtítulos 0,1 segundos', () => adjustSyncOffset(SYNC_STEP_FINE));
    addButton('+1 s', 'Adelantar los subtítulos 1 segundo', () => adjustSyncOffset(SYNC_STEP_COARSE));
    addButton('↺', 'Restablecer el desfase de los subtítulos', () => setSyncOffset(0, { persist: true, announce: true }));

    syncToast = document.createElement('div');
    syncToast.className = 'crunchy-sync-toast';

    syncOverlayRoot.appendChild(syncPanel);
    syncOverlayRoot.appendChild(syncToast);
  }

  if (syncOverlayRoot.parentElement !== parent) {
    parent.appendChild(syncOverlayRoot);
  }

  if (syncOverlayBoundParent !== parent) {
    if (syncOverlayBoundParent) {
      syncOverlayBoundParent.removeEventListener('mousemove', showSyncPanel);
      syncOverlayBoundParent.removeEventListener('mouseleave', hideSyncPanel);
    }
    parent.addEventListener('mousemove', showSyncPanel);
    parent.addEventListener('mouseleave', hideSyncPanel);
    syncOverlayBoundParent = parent;
  }

  updateSyncPanelValue();
}

function showSyncPanel() {
  if (!syncPanel || currentMode === 'off') return;
  syncPanel.classList.add('crunchy-sync-panel--visible');
  if (syncHideTimer) clearTimeout(syncHideTimer);
  syncHideTimer = setTimeout(hideSyncPanel, SYNC_PANEL_HIDE_MS);
}

function hideSyncPanel() {
  if (syncHideTimer) {
    clearTimeout(syncHideTimer);
    syncHideTimer = null;
  }
  if (syncPanel) syncPanel.classList.remove('crunchy-sync-panel--visible');
}

function updateSyncPanelValue(value = syncOffset) {
  if (!syncPanelValue) return;
  syncPanelValue.textContent = formatSyncOffset(value);
  syncPanelValue.classList.toggle('crunchy-sync-value--active', Math.abs(value) > 0.001);
}

function showSyncToast(message) {
  if (!syncToast) return;
  syncToast.textContent = message;
  syncToast.classList.add('crunchy-sync-toast--visible');
  if (syncToastTimer) clearTimeout(syncToastTimer);
  syncToastTimer = setTimeout(() => {
    syncToastTimer = null;
    if (syncToast) syncToast.classList.remove('crunchy-sync-toast--visible');
  }, SYNC_TOAST_MS);
}

function renderSubs(subObjects) {
  clearSubtitles();
  if (!subsContainerStage) return;

  const metrics = getVideoMetrics();
  if (!metrics) return;

  const entries = [];
  subObjects.forEach(sub => {
    if (!sub.text || !sub.text.trim()) return;
    const div = document.createElement('div');
    const isSign = sub.isSign === true;
    const useAssForCue = isSign;

    const variantClass = useAssForCue ? 'crunchy-sub-line--original' : 'crunchy-sub-line--custom';
    div.className = `crunchy-sub-line ${variantClass}${isSign ? ' crunchy-sub-line--sign' : ''}`;
    div.textContent = sub.text;

    const placement = getCuePlacement(sub, metrics, useAssForCue);
    div.style.left = `${placement.left}px`;
    div.style.top = `${placement.top}px`;
    div.style.transform = placement.transform;
    div.style.textAlign = placement.textAlign;

    if (useAssForCue) {
      applyOriginalCueStyle(div, sub, metrics);
    } else {
      applyCustomCueStyle(div, sub);
    }

    subsContainerStage.appendChild(div);
    clampCueToViewport(div, metrics);
    entries.push({ cue: sub, element: div });
  });

  renderedSubtitleEntries = entries;
  updateRenderedFade(videoElement ? videoElement.currentTime + syncOffset : 0);
}

function clearSubtitles() {
  if (subsContainerStage) subsContainerStage.innerHTML = '';
  renderedSubtitleEntries = [];
}

let lastRenderedHash = "";
let lastRenderedLayoutHash = "";

function getVideoMetrics() {
  if (!subsContainerStage || !videoElement) return null;

  const stageRect = subsContainerStage.getBoundingClientRect();
  const videoRect = videoElement.getBoundingClientRect();
  const stageWidth = stageRect.width || videoRect.width;
  const stageHeight = stageRect.height || videoRect.height;
  const videoWidth = videoRect.width || stageWidth;
  const videoHeight = videoRect.height || stageHeight;

  if (!stageWidth || !stageHeight || !videoWidth || !videoHeight) return null;

  return {
    stageWidth,
    stageHeight,
    videoWidth,
    videoHeight,
    offsetLeft: videoRect.left - stageRect.left,
    offsetTop: videoRect.top - stageRect.top
  };
}

function getVideoLayoutHash() {
  const metrics = getVideoMetrics();
  if (!metrics) return '';
  return [
    Math.round(metrics.stageWidth),
    Math.round(metrics.stageHeight),
    Math.round(metrics.videoWidth),
    Math.round(metrics.videoHeight),
    Math.round(metrics.offsetLeft),
    Math.round(metrics.offsetTop)
  ].join(':');
}

function getAlignmentAnchor(alignment) {
  const value = Number(alignment);
  const normalized = Number.isInteger(value) && value >= 1 && value <= 9 ? value : 2;
  return {
    horizontal: [1, 4, 7].includes(normalized) ? 'left' : ([3, 6, 9].includes(normalized) ? 'right' : 'center'),
    vertical: [7, 8, 9].includes(normalized) ? 'top' : ([4, 5, 6].includes(normalized) ? 'middle' : 'bottom')
  };
}

function getCuePlacement(cue, metrics, originalStyle) {
  const anchor = getAlignmentAnchor(cue.alignment);
  if (!originalStyle) {
    const isLegacyTop = Number(cue.alignment) >= 4 && Number(cue.alignment) <= 9;
    const top = isLegacyTop
      ? metrics.videoHeight * 0.1
      : metrics.videoHeight * (1 - verticalPosition / 100);
    return {
      left: metrics.offsetLeft + metrics.videoWidth / 2,
      top: metrics.offsetTop + top,
      transform: isLegacyTop ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
      textAlign: 'center'
    };
  }

  const style = cue.assStyle || {};
  const playResX = subtitlePlayRes.x || 384;
  const playResY = subtitlePlayRes.y || 288;
  const scaleX = metrics.videoWidth / playResX;
  const scaleY = metrics.videoHeight / playResY;
  const marginLeft = Number(style.marginL) || 0;
  const marginRight = Number(style.marginR) || 0;
  const marginVertical = Number(style.marginV) || 0;
  const position = cue.position;
  const verticalNudge = (verticalPosition - 10) / 100 * metrics.videoHeight;

  let x;
  if (position && Number.isFinite(Number(position.x))) {
    x = Number(position.x) * scaleX;
  } else if (anchor.horizontal === 'left') {
    x = marginLeft * scaleX;
  } else if (anchor.horizontal === 'right') {
    x = metrics.videoWidth - marginRight * scaleX;
  } else {
    x = metrics.videoWidth / 2;
  }

  let y;
  if (position && Number.isFinite(Number(position.y))) {
    y = Number(position.y) * scaleY;
  } else if (anchor.vertical === 'top') {
    y = marginVertical * scaleY;
  } else if (anchor.vertical === 'middle') {
    y = metrics.videoHeight / 2;
  } else {
    y = metrics.videoHeight - marginVertical * scaleY;
  }

  y += verticalNudge;

  return {
    left: metrics.offsetLeft + x,
    top: metrics.offsetTop + y,
    transform: `translate(${anchor.horizontal === 'left' ? '0' : (anchor.horizontal === 'right' ? '-100%' : '-50%')}, ${anchor.vertical === 'top' ? '0' : (anchor.vertical === 'bottom' ? '-100%' : '-50%')})`,
    textAlign: anchor.horizontal
  };
}

function clampCueToViewport(element, metrics) {
  const elementRect = element.getBoundingClientRect();
  if (!elementRect.width || !elementRect.height) return;

  const stageRect = subsContainerStage.getBoundingClientRect();
  const left = elementRect.left - stageRect.left;
  const top = elementRect.top - stageRect.top;
  const right = left + elementRect.width;
  const bottom = top + elementRect.height;

  const minX = metrics.offsetLeft;
  const minY = metrics.offsetTop;
  const maxX = metrics.offsetLeft + metrics.videoWidth;
  const maxY = metrics.offsetTop + metrics.videoHeight;

  let deltaX = 0;
  let deltaY = 0;

  if (left < minX) {
    deltaX = minX - left;
  } else if (right > maxX) {
    deltaX = maxX - right;
  }

  if (top < minY) {
    deltaY = minY - top;
  } else if (bottom > maxY) {
    deltaY = maxY - bottom;
  }

  if (!deltaX && !deltaY) return;

  element.style.left = `${parseFloat(element.style.left) + deltaX}px`;
  element.style.top = `${parseFloat(element.style.top) + deltaY}px`;
}

function applyCustomCueStyle(element, cue) {
  element.style.opacity = '1';
  element.style.fontStyle = cue && cue.assStyle && cue.assStyle.italic ? 'italic' : 'normal';
}

function readFontScale() {
  if (!subsContainer) return 1;
  const raw = getComputedStyle(subsContainer).getPropertyValue('--sub-font-scale');
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function assLengthToPixels(value, metrics, baseScale) {
  if (baseScale !== undefined) {
    return Math.max(0, Number(value) || 0) * baseScale;
  }
  const scale = ((metrics.videoWidth / (subtitlePlayRes.x || 384)) + (metrics.videoHeight / (subtitlePlayRes.y || 288))) / 2;
  return Math.max(0, Number(value) || 0) * scale;
}

function buildAssTextShadow(style, metrics, baseScale) {
  const outline = assLengthToPixels(style.outline, metrics, baseScale);
  const shadow = assLengthToPixels(style.shadow, metrics, baseScale);
  const outlineColor = style.outlineColor && style.outlineColor.css;
  const shadowColor = style.shadowColor && style.shadowColor.css;
  const shadows = [];

  if (outline > 0.1 && outlineColor) {
    const size = `${outline.toFixed(2)}px`;
    shadows.push(
      `-${size} 0 0 ${outlineColor}`, `${size} 0 0 ${outlineColor}`,
      `0 -${size} 0 ${outlineColor}`, `0 ${size} 0 ${outlineColor}`,
      `-${size} -${size} 0 ${outlineColor}`, `${size} -${size} 0 ${outlineColor}`,
      `-${size} ${size} 0 ${outlineColor}`, `${size} ${size} 0 ${outlineColor}`
    );
  }

  if (shadow > 0.1 && shadowColor) {
    const size = `${shadow.toFixed(2)}px`;
    shadows.push(`${size} ${size} ${size} ${shadowColor}`);
  }

  return shadows.length > 0 ? shadows.join(', ') : 'none';
}

function applyOriginalCueStyle(element, cue, metrics) {
  const style = cue.assStyle || {};
  const scaleY = metrics.videoHeight / (subtitlePlayRes.y || 288);
  const scaleX = metrics.videoWidth / (subtitlePlayRes.x || 384);
  const baseScale = (scaleX + scaleY) / 2;
  const fontScale = readFontScale();
  const signScale = cue.isSign === true ? Math.max(0.1, signSizeScale / 100) : 1;
  const color = style.primaryColor && style.primaryColor.css;

  element.style.fontFamily = style.fontName || 'Arial, sans-serif';
  if (Number.isFinite(Number(style.fontSize)) && Number(style.fontSize) > 0) {
    const styleScale = Number(style.scaleY) > 0 ? Number(style.scaleY) / 100 : 1;
    const computedPx = Number(style.fontSize) * baseScale * styleScale * fontScale * signScale;
    element.style.fontSize = `${Math.max(1, computedPx)}px`;
  }
  if (color) element.style.color = color;
  element.style.fontWeight = style.bold ? '700' : '400';
  element.style.fontStyle = style.italic ? 'italic' : 'normal';
  element.style.textDecoration = [style.underline ? 'underline' : '', style.strikeOut ? 'line-through' : '']
    .filter(Boolean)
    .join(' ') || 'none';
  if (Number(style.spacing)) {
    element.style.letterSpacing = `${assLengthToPixels(style.spacing, metrics, baseScale)}px`;
  }
  element.style.textShadow = buildAssTextShadow(style, metrics, baseScale);
  element.style.backgroundColor = 'transparent';
  element.style.padding = '0';
  element.style.borderRadius = '0';
  element.style.margin = '0';
  element.style.maxWidth = '90%';

  if (style.borderStyle === 3 && style.backColor && style.backColor.alpha > 0 && !cue.position) {
    element.style.backgroundColor = style.backColor.css;
    element.style.padding = `${Math.max(1, assLengthToPixels(2, metrics, baseScale))}px ${Math.max(2, assLengthToPixels(4, metrics, baseScale))}px`;
  }
}

function updateRenderedFade(currentTime) {
  renderedSubtitleEntries.forEach(({ cue, element }) => {
    let opacity = 1;
    if (cue.fadeIn > 0) {
      opacity = Math.min(opacity, Math.max(0, (currentTime - cue.start) / (cue.fadeIn / 1000)));
    }
    if (cue.fadeOut > 0) {
      opacity = Math.min(opacity, Math.max(0, (cue.end - currentTime) / (cue.fadeOut / 1000)));
    }
    element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
  });
}

function setupVideoListeners() {
  if (timeUpdateListener) {
    videoElement.removeEventListener('timeupdate', timeUpdateListener);
    timeUpdateListener = null;
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  function loop() {
    if (isSubtitleModeActive() && localSubtitles.length > 0) {
      renderLocalSubtitles();
    }
    animationFrameId = requestAnimationFrame(loop);
  }
  animationFrameId = requestAnimationFrame(loop);
}

let lastPreloadTime = 0;

function renderLocalSubtitles() {
  if (!videoElement) return;
  const currentTime = videoElement.currentTime + syncOffset;
  const activeSubs = localSubtitles.filter(sub => currentTime >= sub.start && currentTime <= sub.end);

  const currentHash = getSubtitleHash(activeSubs);
  const currentLayoutHash = getVideoLayoutHash();
  if (currentHash !== lastRenderedHash || currentLayoutHash !== lastRenderedLayoutHash) {
    lastRenderedHash = currentHash;
    lastRenderedLayoutHash = currentLayoutHash;
    if (activeSubs.length > 0) {
      if (currentMode === 'auto') {
        translateAndShow(activeSubs);
      } else {
        renderSubs(activeSubs);
      }
    } else {
      clearSubtitles();
    }
  }
  updateRenderedFade(currentTime);

  const now = performance.now();
  if (currentMode === 'auto' && (now - lastPreloadTime > 1000)) {
    lastPreloadTime = now;
    const upcomingStarts = localSubtitles
      .filter(sub => sub.start > currentTime && sub.start <= currentTime + 5)
      .map(sub => sub.start);
      
    [...new Set(upcomingStarts)].forEach(time => {
      const activeThen = localSubtitles.filter(sub => time + 0.01 >= sub.start && time + 0.01 <= sub.end);
      activeThen.forEach(sub => preloadTranslation(sub.text));
    });
  }
}

function getSubtitleHash(subtitles) {
  return subtitles.map(sub => {
    const position = sub.position ? `${sub.position.x},${sub.position.y}` : '';
    const style = sub.assStyle || {};
    const color = style.primaryColor && style.primaryColor.css || '';
    return [sub.start, sub.end, sub.text, sub.alignment, position, color].join('\u001f');
  }).join('\u001e');
}

function normalizeTranslationSpacing(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function getStutterInfo(text) {
  const normalized = normalizeTranslationSpacing(text);
  const stutterPattern = /\b([A-Za-z])-\1(?=[A-Za-z])/gi;
  const markers = [];
  let cleanText = '';
  let lastIndex = 0;

  normalized.replace(stutterPattern, (match, letter, offset) => {
    cleanText += normalized.slice(lastIndex, offset);
    markers.push({ index: cleanText.length, letter });
    cleanText += letter;
    lastIndex = offset + match.length;
    return match;
  });

  cleanText += normalized.slice(lastIndex);
  return { text: cleanText, markers };
}

function normalizeTranslationText(text) {
  return getStutterInfo(text).text;
}

function restoreStutters(translatedText, originalText) {
  const source = getStutterInfo(originalText);
  let translated = normalizeTranslationSpacing(translatedText);
  if (!translated || !source.markers.length || !source.text.length) return translated;

  const markers = [...source.markers].sort((left, right) => right.index - left.index);
  markers.forEach(marker => {
    const targetPosition = translated.length * (marker.index / source.text.length);
    const wordMatches = [...translated.matchAll(/\S+/g)];
    let selected = null;
    let bestDistance = Infinity;

    wordMatches.forEach(match => {
      const word = match[0];
      if (!/[\p{L}\p{N}]/u.test(word)) return;

      const start = match.index;
      const end = start + word.length;
      const distance = targetPosition < start
        ? start - targetPosition
        : (targetPosition > end ? targetPosition - end : 0);
      if (distance < bestDistance) {
        bestDistance = distance;
        selected = match;
      }
    });

    if (!selected) return;

    const word = selected[0];
    const leading = (word.match(/^[^\p{L}\p{N}]*/u) || [''])[0];
    const translatedWord = word.slice(leading.length);
    if (!translatedWord || /^[\p{L}\p{N}]-/u.test(translatedWord)) return;

    const initial = Array.from(translatedWord)[0];
    const replacement = `${leading}${initial}-${translatedWord}`;
    translated = `${translated.slice(0, selected.index)}${replacement}${translated.slice(selected.index + word.length)}`;
  });

  return translated;
}

function splitTranslatedText(translatedText, originalText) {
  const translated = normalizeTranslationSpacing(translatedText);
  const originalLines = String(originalText || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  if (!translated || originalLines.length <= 1) return translated;

  const sourceLengths = originalLines.map(line => line.trim().length);
  const sourceTotal = sourceLengths.reduce((total, length) => total + length, 0);
  const words = translated.split(' ');
  if (sourceTotal <= 0 || words.length < originalLines.length) return translated;

  const boundaries = [];
  let position = 0;
  words.forEach((word, index) => {
    position += word.length;
    boundaries.push({ index: index + 1, position });
    position += 1;
  });

  const lines = [];
  let wordStart = 0;
  let sourceOffset = 0;

  for (let lineIndex = 0; lineIndex < originalLines.length - 1; lineIndex += 1) {
    sourceOffset += sourceLengths[lineIndex];
    const targetPosition = translated.length * (sourceOffset / sourceTotal);
    const minIndex = wordStart + 1;
    const maxIndex = words.length - (originalLines.length - lineIndex - 1);
    let bestIndex = minIndex;
    let bestDistance = Infinity;

    for (let boundaryIndex = minIndex; boundaryIndex <= maxIndex; boundaryIndex += 1) {
      const boundary = boundaries[boundaryIndex - 1];
      const distance = Math.abs(boundary.position - targetPosition);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = boundary.index;
      }
    }

    lines.push(words.slice(wordStart, bestIndex).join(' '));
    wordStart = bestIndex;
  }

  lines.push(words.slice(wordStart).join(' '));
  return lines.join('\n');
}

function preloadTranslation(text) {
  const sourceLanguage = getTranslationLanguageCode(currentSourceLang);
  const targetLanguage = getTranslationLanguageCode(currentTargetLang);
  const normalizedText = normalizeTranslationText(text);
  if (!normalizedText || sourceLanguage === targetLanguage) return;

  const cacheKey = `${sourceLanguage}\u0000${targetLanguage}\u0000${normalizedText}`;
  const requestGeneration = translationGeneration;
  if (cachedTranslations.has(cacheKey) || preloadingSet.has(cacheKey) || isTranslationBackingOff(cacheKey)) return;

  preloadingSet.add(cacheKey);
  chrome.runtime.sendMessage({
    action: 'TRANSLATE',
    text: normalizedText,
    sl: sourceLanguage,
    tl: targetLanguage
  }, (response) => {
    preloadingSet.delete(cacheKey);
    if (chrome.runtime.lastError) return;
    if (requestGeneration !== translationGeneration) return;
    if (response && response.success) {
      cachedTranslations.set(cacheKey, response.text);
      failedTranslations.delete(cacheKey);
    } else {
      registerTranslationFailure(cacheKey);
    }
  });
}

function parseSubtitlesLegacy(content, isRemote = false) {
  debugLog("Parsing subtitles...");
  const parsedSubtitles = [];
  invalidateTranslations();

  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  if (text.includes('[Events]') && text.includes('Dialogue:')) {
    const lines = text.split('\n');
    let styleFormat = [];
    let alignmentIndex = -1;
    let nameIndex = -1;
    const stylesMap = {};

    lines.forEach(line => {
      const tLine = line.trim();
      if (tLine.startsWith('Format:') && tLine.includes('Name') && tLine.includes('Alignment')) {
         styleFormat = tLine.substring(7).split(',').map(s => s.trim());
         alignmentIndex = styleFormat.indexOf('Alignment');
         nameIndex = styleFormat.indexOf('Name');
      } else if (tLine.startsWith('Style:')) {
         if (alignmentIndex !== -1 && nameIndex !== -1) {
            const parts = tLine.substring(6).split(',');
            if (parts.length >= styleFormat.length) {
               const styleName = parts[nameIndex].trim();
               let alignValStr = parts[alignmentIndex].trim();
               if (parts.length > styleFormat.length) {
                  alignValStr = parts[parts.length - (styleFormat.length - alignmentIndex)].trim();
               }
               const alignVal = parseInt(alignValStr, 10);
               stylesMap[styleName] = (alignVal >= 4 && alignVal <= 9) ? 'top' : 'bottom';
            }
         }
      } else if (tLine.startsWith('Dialogue:')) {
        const parts = tLine.split(',');
        if (parts.length >= 10) {
          const startStr = parts[1].trim();
          const endStr = parts[2].trim();
          const styleName = parts[3].trim();
          const start = parseTime(startStr);
          const end = parseTime(endStr);
          
          let subText = parts.slice(9).join(',').trim();
          let alignment = stylesMap[styleName] || 'bottom';
          
          if (subText.match(/\{\\(an?[456789])\}/)) {
             alignment = 'top';
          }
          
          subText = subText.replace(/\{[^}]+\}/g, '');
          subText = subText.replace(/\\N\s*-/g, '\n-').replace(/\\N/g, ' ').replace(/ {2,}/g, ' ').trim();
          
          if (start !== null && end !== null && subText) {
              parsedSubtitles.push({ start, end, text: subText, alignment });
          }
        }
      }
    });
  } else {
    const blocks = text.split(/\n\n+/);
    blocks.forEach(block => {
      const lines = block.split('\n');
      if (lines.length >= 2) {
        let timeLineIdx = 0;
        if (!lines[timeLineIdx].includes('-->')) timeLineIdx = 1;
        if (timeLineIdx < lines.length && lines[timeLineIdx].includes('-->')) {
          const times = lines[timeLineIdx].split('-->');
          const start = parseTime(times[0].trim());
          const end = parseTime(times[1].trim());
          let subText = lines.slice(timeLineIdx + 1).join('\n');
          subText = subText.replace(/\n\s*-/g, '\n-').replace(/\n(?!\s*-)/g, ' ').replace(/ {2,}/g, ' ').trim();
           if (start !== null && end !== null && subText) parsedSubtitles.push({ start, end, text: subText, alignment: 'bottom' });
        }
      }
    });
  }
  if (isRemote) {
    remoteSubtitles = parsedSubtitles;
    if (usesOfficialTrack()) localSubtitles = parsedSubtitles;
  } else {
    localSubtitles = parsedSubtitles;
  }

  debugLog("Parsed subtitles count:", parsedSubtitles.length);
  return parsedSubtitles;
}

const DEFAULT_ASS_STYLE_FORMAT = [
  'Name', 'Fontname', 'Fontsize', 'PrimaryColour', 'SecondaryColour',
  'OutlineColour', 'BackColour', 'Bold', 'Italic', 'Underline', 'StrikeOut',
  'ScaleX', 'ScaleY', 'Spacing', 'Angle', 'BorderStyle', 'Outline', 'Shadow',
  'Alignment', 'MarginL', 'MarginR', 'MarginV', 'Encoding'
];

const DEFAULT_ASS_EVENT_FORMAT = [
  'Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'
];

function createDefaultAssStyle() {
  return {
    fontName: 'Arial',
    fontSize: 20,
    primaryColor: parseAssColor('&H00FFFFFF&'),
    outlineColor: parseAssColor('&H00000000&'),
    shadowColor: parseAssColor('&H00000000&'),
    backColor: parseAssColor('&H00000000&'),
    bold: false,
    italic: false,
    underline: false,
    strikeOut: false,
    scaleX: 100,
    scaleY: 100,
    spacing: 0,
    borderStyle: 1,
    outline: 2,
    shadow: 2,
    alignment: 2,
    marginL: 10,
    marginR: 10,
    marginV: 10
  };
}

function cloneAssColor(color) {
  return color ? { ...color } : null;
}

function cloneAssStyle(style) {
  return {
    ...style,
    primaryColor: cloneAssColor(style.primaryColor),
    outlineColor: cloneAssColor(style.outlineColor),
    shadowColor: cloneAssColor(style.shadowColor),
    backColor: cloneAssColor(style.backColor)
  };
}

function parseAssColor(value) {
  const rawValue = String(value || '').trim();
  const match = rawValue.match(/^&H([0-9A-F]+)&?$/i) || rawValue.match(/^0x([0-9A-F]+)$/i);
  if (!match) return null;

  let hex = match[1];
  if (hex.length <= 6) {
    hex = hex.padStart(6, '0');
  } else {
    hex = hex.padStart(8, '0').slice(-8);
  }

  const hasAlpha = hex.length > 6;
  const alphaByte = hasAlpha ? parseInt(hex.slice(0, 2), 16) : 0;
  const blue = parseInt(hex.slice(hasAlpha ? 2 : 0, hasAlpha ? 4 : 2), 16);
  const green = parseInt(hex.slice(hasAlpha ? 4 : 2, hasAlpha ? 6 : 4), 16);
  const red = parseInt(hex.slice(hasAlpha ? 6 : 4, hasAlpha ? 8 : 6), 16);
  const alpha = (255 - alphaByte) / 255;

  return {
    red,
    green,
    blue,
    alpha,
    css: `rgba(${red}, ${green}, ${blue}, ${Number(alpha.toFixed(3))})`
  };
}

function assColorToRgba(value) {
  const color = parseAssColor(value);
  return color ? color.css : null;
}

function assColorWithAlpha(color, alphaByte) {
  if (!color || !Number.isFinite(alphaByte)) return color;
  const alpha = (255 - Math.max(0, Math.min(255, alphaByte))) / 255;
  return {
    ...color,
    alpha,
    css: `rgba(${color.red}, ${color.green}, ${color.blue}, ${Number(alpha.toFixed(3))})`
  };
}

function normalizeAssFieldName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '');
}

function firstAssValue(values, names) {
  for (const name of names) {
    const value = values[normalizeAssFieldName(name)];
    if (value !== undefined) return value;
  }
  return '';
}

function parseAssBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  const number = Number(String(value).trim());
  if (!Number.isFinite(number)) return fallback;
  return number !== 0;
}

function parseAssNumber(value, fallback) {
  const number = Number(String(value ?? '').trim());
  return Number.isFinite(number) ? number : fallback;
}

function parseAssStyleRecord(line, format) {
  const style = createDefaultAssStyle();
  const values = {};
  const rawValues = line.replace(/^Style\s*:/i, '').split(',');
  format.forEach((field, index) => {
    values[normalizeAssFieldName(field)] = rawValues[index] === undefined ? '' : rawValues[index].trim();
  });

  const primary = parseAssColor(firstAssValue(values, ['PrimaryColour', 'PrimaryColor']));
  const outline = parseAssColor(firstAssValue(values, ['OutlineColour', 'OutlineColor', 'TertiaryColour', 'TertiaryColor']));
  const back = parseAssColor(firstAssValue(values, ['BackColour', 'BackColor']));
  const name = firstAssValue(values, ['Name']);
  if (!name) return null;

  style.name = name;
  style.fontName = firstAssValue(values, ['Fontname', 'FontName']) || style.fontName;
  style.fontSize = parseAssNumber(firstAssValue(values, ['Fontsize', 'FontSize']), style.fontSize);
  style.primaryColor = primary || style.primaryColor;
  style.outlineColor = outline || style.outlineColor;
  style.backColor = back || style.backColor;
  style.shadowColor = cloneAssColor(style.backColor);
  style.bold = parseAssBoolean(firstAssValue(values, ['Bold']), style.bold);
  style.italic = parseAssBoolean(firstAssValue(values, ['Italic']), style.italic);
  style.underline = parseAssBoolean(firstAssValue(values, ['Underline']), style.underline);
  style.strikeOut = parseAssBoolean(firstAssValue(values, ['StrikeOut']), style.strikeOut);
  style.scaleX = parseAssNumber(firstAssValue(values, ['ScaleX']), style.scaleX);
  style.scaleY = parseAssNumber(firstAssValue(values, ['ScaleY']), style.scaleY);
  style.spacing = parseAssNumber(firstAssValue(values, ['Spacing']), style.spacing);
  style.borderStyle = parseAssNumber(firstAssValue(values, ['BorderStyle']), style.borderStyle);
  style.outline = parseAssNumber(firstAssValue(values, ['Outline']), style.outline);
  style.shadow = parseAssNumber(firstAssValue(values, ['Shadow']), style.shadow);
  style.alignment = Math.max(1, Math.min(9, Math.round(parseAssNumber(firstAssValue(values, ['Alignment']), style.alignment))));
  style.marginL = parseAssNumber(firstAssValue(values, ['MarginL']), style.marginL);
  style.marginR = parseAssNumber(firstAssValue(values, ['MarginR']), style.marginR);
  style.marginV = parseAssNumber(firstAssValue(values, ['MarginV']), style.marginV);
  return style;
}

function parseAssPosition(value) {
  const numbers = String(value || '').split(',').map(item => Number(item.trim()));
  if (numbers.length < 2 || !numbers.slice(0, 2).every(Number.isFinite)) return null;
  return { x: numbers[0], y: numbers[1] };
}

function parseAssOverrides(rawText, baseStyle, stylesMap) {
  let style = cloneAssStyle(baseStyle);
  let alignment = style.alignment;
  let position = null;
  let fadeIn = 0;
  let fadeOut = 0;

  const blocks = rawText.match(/\{[^}]*\}/g) || [];
  blocks.forEach(block => {
    const tags = block.slice(1, -1);
    const reset = tags.match(/\\r([^\\}]*)/i);
    if (reset) {
      const resetName = reset[1].trim().toLowerCase();
      style = resetName && stylesMap[resetName]
        ? cloneAssStyle(stylesMap[resetName])
        : cloneAssStyle(baseStyle);
      alignment = style.alignment;
    }

    const alignmentMatch = tags.match(/\\an([1-9])/i);
    if (alignmentMatch) alignment = Number(alignmentMatch[1]);

    const positionMatch = tags.match(/\\pos\(([^)]*)\)/i);
    if (positionMatch) position = parseAssPosition(positionMatch[1]);

    const moveMatch = tags.match(/\\move\(([^)]*)\)/i);
    if (moveMatch) {
      const moveValues = moveMatch[1].split(',').map(value => Number(value.trim()));
      if (moveValues.length >= 4 && moveValues.slice(0, 4).every(Number.isFinite)) {
        position = { x: moveValues[0], y: moveValues[1] };
      }
    }

    const primaryColorMatch = tags.match(/\\(?:1c|c)\s*&H([0-9A-F]+)&/i);
    if (primaryColorMatch) {
      style.primaryColor = parseAssColor(`&H${primaryColorMatch[1]}&`) || style.primaryColor;
    }
    const outlineColorMatch = tags.match(/\\3c\s*&H([0-9A-F]+)&/i);
    if (outlineColorMatch) {
      style.outlineColor = parseAssColor(`&H${outlineColorMatch[1]}&`) || style.outlineColor;
    }
    const shadowColorMatch = tags.match(/\\4c\s*&H([0-9A-F]+)&/i);
    if (shadowColorMatch) {
      style.shadowColor = parseAssColor(`&H${shadowColorMatch[1]}&`) || style.shadowColor;
    }

    const alphaMatch = tags.match(/\\(?:1a|alpha)\s*&H([0-9A-F]{2})&/i);
    if (alphaMatch) {
      style.primaryColor = assColorWithAlpha(style.primaryColor, parseInt(alphaMatch[1], 16));
    }

    const fontSizeMatch = tags.match(/\\fs([0-9]+(?:\.[0-9]+)?)/i);
    if (fontSizeMatch) style.fontSize = parseAssNumber(fontSizeMatch[1], style.fontSize);
    const fontNameMatch = tags.match(/\\fn([^\\}]*)/i);
    if (fontNameMatch && fontNameMatch[1].trim()) style.fontName = fontNameMatch[1].trim();

    const boldMatch = tags.match(/\\b(-?[0-9]+)/i);
    if (boldMatch) style.bold = Number(boldMatch[1]) !== 0;
    const italicMatch = tags.match(/\\i(-?[0-9]+)/i);
    if (italicMatch) style.italic = Number(italicMatch[1]) !== 0;
    const underlineMatch = tags.match(/\\u(-?[0-9]+)/i);
    if (underlineMatch) style.underline = Number(underlineMatch[1]) !== 0;
    const strikeMatch = tags.match(/\\s(-?[0-9]+)/i);
    if (strikeMatch) style.strikeOut = Number(strikeMatch[1]) !== 0;
    const outlineMatch = tags.match(/\\bord([0-9]+(?:\.[0-9]+)?)/i);
    if (outlineMatch) style.outline = parseAssNumber(outlineMatch[1], style.outline);
    const shadowMatch = tags.match(/\\shad([0-9]+(?:\.[0-9]+)?)/i);
    if (shadowMatch) style.shadow = parseAssNumber(shadowMatch[1], style.shadow);

    const fadMatch = tags.match(/\\fad\(\s*([0-9]+)\s*,\s*([0-9]+)\s*\)/i);
    if (fadMatch) {
      fadeIn = parseAssNumber(fadMatch[1], 0);
      fadeOut = parseAssNumber(fadMatch[2], 0);
    }
    const fadeMatch = tags.match(/\\fade\(([^)]*)\)/i);
    if (fadeMatch) {
      const fadeValues = fadeMatch[1].split(',').map(value => Number(value.trim()));
      if (fadeValues.length >= 7) {
        fadeIn = Math.max(0, fadeValues[4] - fadeValues[3]);
        fadeOut = Math.max(0, fadeValues[6] - fadeValues[5]);
      }
    }
  });

  return { style, alignment, position, fadeIn, fadeOut };
}

function cleanAssText(rawText) {
  return String(rawText || '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function parseAssEventLine(line, format) {
  const raw = line.replace(/^Dialogue\s*:/i, '').trim();
  const fields = format.length ? format : DEFAULT_ASS_EVENT_FORMAT;
  const textIndex = Math.max(0, fields.findIndex(field => normalizeAssFieldName(field) === 'text'));
  const parts = raw.split(',');
  const values = {};
  let cursor = 0;

  fields.forEach((field, index) => {
    const normalized = normalizeAssFieldName(field);
    if (index === textIndex) {
      values[normalized] = parts.slice(cursor).join(',').trim();
      cursor = parts.length;
    } else {
      values[normalized] = parts[cursor] === undefined ? '' : parts[cursor].trim();
      cursor += 1;
    }
  });

  return {
    start: parseTime(values.start),
    end: parseTime(values.end),
    styleName: values.style || 'default',
    text: values.text || ''
  };
}

function isSignCue(styleName, position) {
  if (position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y))) {
    return true;
  }
  return /sign/i.test(String(styleName || ''));
}

function parseSubtitles(content, isRemote = false) {
  debugLog("Parsing subtitles...");
  const parsedSubtitles = [];
  invalidateTranslations();

  const text = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const isAss = /\[Events\]/i.test(text) && /^\s*Dialogue\s*:/im.test(text);
  subtitlePlayRes = { x: 384, y: 288 };

  if (isAss) {
    const lines = text.split('\n');
    let styleFormat = [];
    let eventFormat = [];
    const stylesMap = Object.create(null);
    const defaultStyle = createDefaultAssStyle();

    lines.forEach(line => {
      const tLine = line.trim();
      if (!tLine) return;

      if (/^\[[^\]]+\]$/.test(tLine)) return;

      const playResXMatch = tLine.match(/^PlayResX\s*:\s*(\d+(?:\.\d+)?)/i);
      const playResYMatch = tLine.match(/^PlayResY\s*:\s*(\d+(?:\.\d+)?)/i);
      if (playResXMatch) subtitlePlayRes.x = Math.max(1, Number(playResXMatch[1]));
      if (playResYMatch) subtitlePlayRes.y = Math.max(1, Number(playResYMatch[1]));

      const formatMatch = tLine.match(/^Format\s*:\s*(.*)$/i);
      if (formatMatch) {
        const fields = formatMatch[1].split(',').map(field => field.trim());
        const normalizedFields = fields.map(normalizeAssFieldName);
        if (normalizedFields.includes('name') && normalizedFields.includes('alignment')) {
          styleFormat = fields;
        } else if (normalizedFields.includes('start') && normalizedFields.includes('end') && normalizedFields.includes('text')) {
          eventFormat = fields;
        }
        return;
      }

      if (/^Style\s*:/i.test(tLine)) {
        const style = parseAssStyleRecord(tLine, styleFormat.length ? styleFormat : DEFAULT_ASS_STYLE_FORMAT);
        if (style) stylesMap[style.name.toLowerCase()] = style;
        return;
      }

      if (/^Dialogue\s*:/i.test(tLine)) {
        const event = parseAssEventLine(tLine, eventFormat);
        const baseStyle = stylesMap[event.styleName.toLowerCase()] || defaultStyle;
        const overrides = parseAssOverrides(event.text, baseStyle, stylesMap);
        const subText = cleanAssText(event.text);
        if (event.start !== null && event.end !== null && subText) {
          parsedSubtitles.push({
            id: parsedSubtitles.length,
            start: event.start,
            end: event.end,
            text: subText,
            alignment: overrides.alignment,
            position: overrides.position,
            pos: overrides.position,
            isAss: true,
            isSign: isSignCue(event.styleName, overrides.position),
            assStyle: overrides.style,
            fadeIn: overrides.fadeIn,
            fadeOut: overrides.fadeOut
          });
        }
      }
    });
  } else {
    const blocks = text.split(/\n\n+/);
    blocks.forEach(block => {
      const lines = block.split('\n');
      if (lines.length < 2) return;

      let timeLineIdx = 0;
      if (!lines[timeLineIdx].includes('-->')) timeLineIdx = 1;
      if (timeLineIdx >= lines.length || !lines[timeLineIdx].includes('-->')) return;

      const times = lines[timeLineIdx].split('-->');
      const start = parseTime(times[0].trim());
      const end = parseTime(times[1].trim().split(/\s+/)[0]);
      let subText = lines.slice(timeLineIdx + 1).join('\n');
      subText = subText.replace(/\n\s*-/g, '\n-').replace(/\n(?!\s*-)/g, ' ').replace(/ {2,}/g, ' ').trim();
      if (start !== null && end !== null && subText) {
        parsedSubtitles.push({
          id: parsedSubtitles.length,
          start,
          end,
          text: subText,
          alignment: 2,
          position: null,
          pos: null,
          isAss: false,
          isSign: false,
          assStyle: null,
          fadeIn: 0,
          fadeOut: 0
        });
      }
    });
  }

  if (isRemote) {
    remoteSubtitles = parsedSubtitles;
    if (usesOfficialTrack()) localSubtitles = parsedSubtitles;
  } else {
    localSubtitles = parsedSubtitles;
  }

  debugLog("Parsed subtitles count:", parsedSubtitles.length);
  return parsedSubtitles;
}

function parseTime(timeString) {
  const normalizedTime = String(timeString || '').trim();
  if (!normalizedTime) return null;
  const parts = normalizedTime.replace(',', '.').split(':');
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    seconds = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  } else if (!isNaN(parseFloat(normalizedTime))) {
    seconds = parseFloat(normalizedTime);
  } else {
    return null;
  }
  return seconds;
}

function translateAndShow(activeSubs) {
  if (!activeSubs.length) return;

  const sourceLanguage = getTranslationLanguageCode(currentSourceLang);
  const targetLanguage = getTranslationLanguageCode(currentTargetLang);
  if (sourceLanguage === targetLanguage) {
    renderSubs(activeSubs);
    return;
  }

  const requestGeneration = translationGeneration;
  const cacheKey = (text) => `${sourceLanguage}\u0000${targetLanguage}\u0000${text}`;

  function rebuildFromCache() {
    return activeSubs.map(cue => {
      const normalizedText = normalizeTranslationText(cue.text);
      const cached = cachedTranslations.get(cacheKey(normalizedText));
      if (cached === undefined) return cue;
      const restored = restoreStutters(cached, cue.text);
      const text = cue.isSign ? splitTranslatedText(restored, cue.text) : restored;
      return { ...cue, text };
    });
  }

  function requestSegment(text) {
    const normalizedText = normalizeTranslationText(text);
    if (!normalizedText) return;
    const segmentKey = cacheKey(normalizedText);
    if (cachedTranslations.has(segmentKey) || isTranslationBackingOff(segmentKey)) return;
    chrome.runtime.sendMessage({
      action: 'TRANSLATE',
      text: normalizedText,
      sl: sourceLanguage,
      tl: targetLanguage
    }, (response) => {
      if (chrome.runtime.lastError) {
        debugLog('Runtime Error:', chrome.runtime.lastError.message);
        return;
      }
      if (requestGeneration !== translationGeneration) return;
      if (!response || !response.success) {
        const wait = registerTranslationFailure(segmentKey);
        debugLog(`Translation failed (${response ? response.error : 'sin respuesta'}). Retry in ${Math.round(wait / 1000)}s`);
        return;
      }
      failedTranslations.delete(segmentKey);
      cachedTranslations.set(segmentKey, response.text);

      const currentHash = getSubtitleHash(activeSubs);
      if (lastRenderedHash === currentHash) {
        renderSubs(rebuildFromCache());
      }
    });
  }

  renderSubs(rebuildFromCache());

  if (translationTimeout) clearTimeout(translationTimeout);
  translationTimeout = setTimeout(() => {
    activeSubs.forEach(cue => {
      if (!cue.text) return;
      requestSegment(cue.text);
    });
  }, 10);
}

init();
