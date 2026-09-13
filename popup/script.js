document.addEventListener('DOMContentLoaded', () => {
  const masterToggle = document.getElementById('master-toggle');
  const panel = document.getElementById('panel');
  const appEl = document.querySelector('.app');
  const statusPill = document.getElementById('status-pill');
  const statusText = document.getElementById('status-text');

  const radioAuto = document.getElementById('mode-auto');
  const radioLocal = document.getElementById('mode-local');
  const radioOriginal = document.getElementById('mode-original');
  const modeHint = document.getElementById('mode-hint');
  const localSection = document.getElementById('local-file-section');
  const languageSection = document.getElementById('language-section');
  const languageTitle = document.getElementById('language-title');
  const sourceLang = document.getElementById('source-lang');
  const sourceLangLabel = document.getElementById('source-lang-label');
  const targetLang = document.getElementById('target-lang');
  const targetControl = document.getElementById('target-lang-control');
  const languageHint = document.getElementById('language-hint');

  const btnBrowse = document.getElementById('btn-browse');
  const fileUpload = document.getElementById('file-upload');
  const dropZone = document.getElementById('drop-zone');
  const fileStatus = document.getElementById('file-status');
  const syncOffset = document.getElementById('sync-offset');

  const subFont = document.getElementById('sub-font');
  const subColor = document.getElementById('sub-color');
  const subBg = document.getElementById('sub-bg');
  const subBgOpacity = document.getElementById('sub-bg-opacity');
  const opacityVal = document.getElementById('opacity-val');
  const subOutline = document.getElementById('sub-outline');
  const subOutlineEnabled = document.getElementById('sub-outline-enabled');
  const chipColor = document.getElementById('chip-color');
  const chipBg = document.getElementById('chip-bg');
  const chipOutline = document.getElementById('chip-outline');
  const outlineColorText = document.getElementById('outline-color-text');

  const subFontSize = document.getElementById('sub-font-size');
  const fontSizeVal = document.getElementById('font-size-val');
  const subOutlineSize = document.getElementById('sub-outline-size');
  const outlineSizeVal = document.getElementById('outline-size-val');
  const subPosition = document.getElementById('sub-position');
  const positionVal = document.getElementById('position-val');
  const useOriginalStyles = null;
  const signSizeScale = document.getElementById('sign-size-scale');
  const signSizeVal = document.getElementById('sign-size-val');
  void useOriginalStyles;

  const btnResetStyles = document.getElementById('btn-reset-styles');

  const syncValue = document.getElementById('sync-value');
  const syncMinusCoarse = document.getElementById('sync-minus-coarse');
  const syncMinusFine = document.getElementById('sync-minus-fine');
  const syncPlusFine = document.getElementById('sync-plus-fine');
  const syncPlusCoarse = document.getElementById('sync-plus-coarse');
  const btnSyncReset = document.getElementById('btn-sync-reset');

  const DEFAULTS = {
    font: '"Trebuchet MS", Arial, sans-serif',
    color: '#ffffff',
    bg: '#000000',
    bgOpacity: '40',
    outline: '#000000',
    outlineEnabled: true,
    fontSize: '100',
    outlineSize: '2',
    position: '10',
    signSizeScale: '70'
  };

  const HINTS = {
    original: 'Se muestra la pista oficial de Crunchyroll tal cual, sin pasar por el traductor.',
    auto: 'Traducción automática con idiomas de origen y destino configurables.',
    local: 'Carga tu propio archivo .srt o .vtt y ajústalo si hace falta.'
  };

  const SUPPORTED_TARGET_LANGUAGES = [
    { code: 'af', label: 'Afrikáans' },
    { code: 'ar', label: 'Árabe' },
    { code: 'bg', label: 'Búlgaro' },
    { code: 'ca', label: 'Catalán' },
    { code: 'cs', label: 'Checo' },
    { code: 'da', label: 'Danés' },
    { code: 'de', label: 'Alemán' },
    { code: 'el', label: 'Griego' },
    { code: 'en', label: 'Inglés' },
    { code: 'es', label: 'Español' },
    { code: 'et', label: 'Estonio' },
    { code: 'fa', label: 'Persa' },
    { code: 'fi', label: 'Finés' },
    { code: 'fr', label: 'Francés' },
    { code: 'he', label: 'Hebreo' },
    { code: 'hi', label: 'Hindi' },
    { code: 'hu', label: 'Húngaro' },
    { code: 'id', label: 'Indonesio' },
    { code: 'it', label: 'Italiano' },
    { code: 'ja', label: 'Japonés' },
    { code: 'ko', label: 'Coreano' },
    { code: 'lt', label: 'Lituano' },
    { code: 'lv', label: 'Letón' },
    { code: 'ms', label: 'Malayo' },
    { code: 'nl', label: 'Neerlandés' },
    { code: 'no', label: 'Noruego' },
    { code: 'pl', label: 'Polaco' },
    { code: 'pt', label: 'Portugués' },
    { code: 'ro', label: 'Rumano' },
    { code: 'ru', label: 'Ruso' },
    { code: 'sk', label: 'Eslovaco' },
    { code: 'sl', label: 'Esloveno' },
    { code: 'sr', label: 'Serbio' },
    { code: 'sv', label: 'Sueco' },
    { code: 'sw', label: 'Suajili' },
    { code: 'ta', label: 'Tamil' },
    { code: 'th', label: 'Tailandés' },
    { code: 'tr', label: 'Turco' },
    { code: 'uk', label: 'Ucraniano' },
    { code: 'vi', label: 'Vietnamita' },
    { code: 'zh-CN', label: 'Chino simplificado' },
    { code: 'zh-TW', label: 'Chino tradicional' }
  ];

  let savedSourceLang = 'en-US';
  let savedTargetLang = 'es';
  let savedLocalFileName = '';
  let syncOffsets = {};
  let legacySyncOffset = 0;

  const MAX_SYNC_OFFSET = 120;

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

  function currentSyncKey() {
    if (currentMode() === 'local' && savedLocalFileName) return `file:${savedLocalFileName}`;
    return `lang:${savedSourceLang}`;
  }

  function currentSyncValue() {
    const key = currentSyncKey();
    if (Object.prototype.hasOwnProperty.call(syncOffsets, key)) {
      return normalizeSyncOffset(syncOffsets[key]);
    }
    if (Object.keys(syncOffsets).length === 0) {
      return normalizeSyncOffset(legacySyncOffset);
    }
    return 0;
  }

  function renderSyncValue() {
    const value = currentSyncValue();
    syncOffset.value = String(value);
    syncValue.textContent = formatSyncOffset(value);
    syncValue.classList.toggle('active', Math.abs(value) > 0.001);
  }

  function persistSyncValue(value) {
    const key = currentSyncKey();
    syncOffsets[key] = value;
    renderSyncValue();
    notifyContentScript({ action: 'OFFSET_CHANGED', offset: value });
    chrome.storage.local.get(['syncOffsets'], (result) => {
      const stored = result.syncOffsets && typeof result.syncOffsets === 'object' ? result.syncOffsets : {};
      stored[key] = value;
      chrome.storage.local.set({ syncOffsets: stored });
    });
  }

  function applySyncDelta(delta) {
    persistSyncValue(normalizeSyncOffset(currentSyncValue() + delta));
  }

  function setSliderFill(el) {
    const min = parseFloat(el.min);
    const max = parseFloat(el.max);
    const val = parseFloat(el.value);
    const pct = ((val - min) / (max - min)) * 100;
    el.style.setProperty('--fill', pct + '%');
  }

  function syncSwatch(input, chip) {
    chip.style.background = input.value;
  }

  function setEnabledUI(enabled) {
    appEl.classList.toggle('disabled', !enabled);
    if (enabled) {
      statusPill.classList.remove('off');
      statusText.textContent = 'Activo';
    } else {
      statusPill.classList.add('off');
      statusText.textContent = 'Inactivo';
    }
  }

  function currentMode() {
    if (radioLocal.checked) return 'local';
    if (radioOriginal.checked) return 'original';
    return 'auto';
  }

  function applyMode(mode) {
    const isLocal = mode === 'local';
    const isOriginal = mode === 'original';

    radioLocal.checked = isLocal;
    radioOriginal.checked = isOriginal;
    radioAuto.checked = !isLocal && !isOriginal;

    localSection.classList.toggle('hidden', !isLocal);
    languageSection.classList.toggle('hidden', isLocal);
    targetControl.classList.toggle('hidden', isOriginal);
    languageTitle.textContent = isOriginal ? 'Idioma del subtítulo' : 'Idiomas de traducción';
    sourceLangLabel.textContent = isOriginal ? 'Idioma a mostrar' : 'Subtítulo de origen';
    modeHint.textContent = isLocal ? HINTS.local : isOriginal ? HINTS.original : HINTS.auto;

    if (!isLocal) updateLanguageHint();
  }

  function baseLanguageCode(code) {
    return String(code || '').replace('_', '-').split('-')[0].toLowerCase();
  }

  function populateTargetLanguages(selectedCode) {
    targetLang.innerHTML = '';
    SUPPORTED_TARGET_LANGUAGES.forEach(language => {
      const option = document.createElement('option');
      option.value = language.code;
      option.textContent = language.label;
      targetLang.appendChild(option);
    });

    const validTarget = SUPPORTED_TARGET_LANGUAGES.some(language => language.code === selectedCode)
      ? selectedCode
      : 'es';
    targetLang.value = validTarget;
    savedTargetLang = validTarget;
  }

  function populateSourceLanguages(languages) {
    const normalizedLanguages = (Array.isArray(languages) ? languages : [])
      .map(language => {
        if (typeof language === 'string') return { code: language, label: language };
        return language && language.code
          ? { code: language.code, label: language.label || language.code }
          : null;
      })
      .filter(Boolean)
      .filter((language, index, all) => all.findIndex(item => item.code === language.code) === index);

    sourceLang.innerHTML = '';
    if (normalizedLanguages.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Cargando idiomas disponibles...';
      option.disabled = true;
      option.selected = true;
      sourceLang.appendChild(option);
      updateLanguageHint();
      return;
    }

    normalizedLanguages.forEach(language => {
      const option = document.createElement('option');
      option.value = language.code;
      option.textContent = language.label;
      sourceLang.appendChild(option);
    });

    const exactMatch = normalizedLanguages.find(language => language.code === savedSourceLang);
    const baseMatch = normalizedLanguages.find(language => baseLanguageCode(language.code) === baseLanguageCode(savedSourceLang));
    const selectedLanguage = exactMatch || baseMatch || normalizedLanguages[0];
    sourceLang.value = selectedLanguage.code;

    if (savedSourceLang !== selectedLanguage.code) {
      savedSourceLang = selectedLanguage.code;
      chrome.storage.local.set({ sourceLang: savedSourceLang });
    }
    updateLanguageHint();
  }

  function updateLanguageHint() {
    const isOriginal = currentMode() === 'original';
    if (!sourceLang.value || (!isOriginal && !targetLang.value)) {
      languageHint.textContent = 'Los idiomas disponibles se actualizan con cada episodio.';
      return;
    }

    const sourceName = sourceLang.options[sourceLang.selectedIndex]?.textContent || sourceLang.value;
    const targetName = targetLang.options[targetLang.selectedIndex]?.textContent || targetLang.value;
    if (currentMode() === 'original') {
      languageHint.textContent = `Se mostrará la pista ${sourceName} sin traducir.`;
      return;
    }
    if (baseLanguageCode(sourceLang.value) === baseLanguageCode(targetLang.value)) {
      languageHint.textContent = `El origen y el destino son ${sourceName}; se mostrarán sin traducir.`;
    } else {
      languageHint.textContent = `Traduce de ${sourceName} a ${targetName} en tiempo real.`;
    }
  }

  chrome.storage.local.get([
    'subMode',
    'syncOffset',
    'syncOffsets',
    'localFileName',
    'localFileContent',
    'subStyles',
    'availableLangs',
    'sourceLang',
    'targetLang'
  ], (result) => {
    savedSourceLang = result.sourceLang || 'en-US';
    populateTargetLanguages(result.targetLang || 'es');
    populateSourceLanguages(result.availableLangs || []);

    const mode = result.subMode || 'auto';
    if (mode === 'off') {
      masterToggle.checked = false;
      setEnabledUI(false);
      applyMode('auto');
    } else {
      masterToggle.checked = true;
      setEnabledUI(true);
      applyMode(mode);
    }

    syncOffsets = result.syncOffsets && typeof result.syncOffsets === 'object' ? result.syncOffsets : {};
    legacySyncOffset = typeof result.syncOffset === 'number' ? result.syncOffset : 0;
    savedLocalFileName = result.localFileName || '';
    renderSyncValue();

    if (result.localFileName) {
      fileStatus.textContent = `Archivo: ${result.localFileName}`;
      fileStatus.style.color = 'var(--ok)';
    }

    const s = result.subStyles || {};
    subFont.value = s.font || DEFAULTS.font;
    subColor.value = s.color || DEFAULTS.color;
    subBg.value = s.bg || DEFAULTS.bg;
    subBgOpacity.value = s.bgOpacity !== undefined ? s.bgOpacity : DEFAULTS.bgOpacity;
    opacityVal.textContent = subBgOpacity.value + '%';
    subOutline.value = s.outline || DEFAULTS.outline;
    subOutlineEnabled.checked = s.outlineEnabled !== undefined ? s.outlineEnabled : DEFAULTS.outlineEnabled;
    subFontSize.value = s.fontSize !== undefined ? s.fontSize : DEFAULTS.fontSize;
    fontSizeVal.textContent = subFontSize.value + '%';
    subOutlineSize.value = s.outlineSize !== undefined ? s.outlineSize : DEFAULTS.outlineSize;
    outlineSizeVal.textContent = subOutlineSize.value + 'px';
    subPosition.value = s.position !== undefined ? s.position : DEFAULTS.position;
    positionVal.textContent = subPosition.value + '%';
    signSizeScale.value = s.signSizeScale !== undefined ? s.signSizeScale : DEFAULTS.signSizeScale;
    signSizeVal.textContent = signSizeScale.value + '%';

    [subBgOpacity, subFontSize, subOutlineSize, subPosition, signSizeScale].forEach(setSliderFill);
    syncSwatch(subColor, chipColor);
    syncSwatch(subBg, chipBg);
    syncSwatch(subOutline, chipOutline);
    outlineColorText.textContent = subOutline.value;

    requestAvailableLanguages();
  });

  function saveStyles() {
    const styles = {
      font: subFont.value,
      color: subColor.value,
      bg: subBg.value,
      bgOpacity: subBgOpacity.value,
      outline: subOutline.value,
      outlineEnabled: subOutlineEnabled.checked,
      fontSize: subFontSize.value,
      outlineSize: subOutlineSize.value,
      position: subPosition.value,
      signSizeScale: signSizeScale.value
    };
    chrome.storage.local.set({ subStyles: styles });
    notifyContentScript({ action: 'STYLE_CHANGED', styles: styles });
  }

  [subFont, subColor, subBg, subOutline].forEach(el => {
    el.addEventListener('input', () => {
      syncSwatch(subColor, chipColor);
      syncSwatch(subBg, chipBg);
      syncSwatch(subOutline, chipOutline);
      if (el === subOutline) outlineColorText.textContent = subOutline.value;
      saveStyles();
    });
  });

  subOutlineEnabled.addEventListener('change', saveStyles);

  subBgOpacity.addEventListener('input', (e) => {
    opacityVal.textContent = e.target.value + '%';
    setSliderFill(e.target);
    saveStyles();
  });
  subFontSize.addEventListener('input', (e) => {
    fontSizeVal.textContent = e.target.value + '%';
    setSliderFill(e.target);
    saveStyles();
  });
  subOutlineSize.addEventListener('input', (e) => {
    outlineSizeVal.textContent = e.target.value + 'px';
    setSliderFill(e.target);
    saveStyles();
  });
  subPosition.addEventListener('input', (e) => {
    positionVal.textContent = e.target.value + '%';
    setSliderFill(e.target);
    saveStyles();
  });
  signSizeScale.addEventListener('input', (e) => {
    signSizeVal.textContent = e.target.value + '%';
    setSliderFill(e.target);
    saveStyles();
  });

  btnResetStyles.addEventListener('click', () => {
    subFont.value = DEFAULTS.font;
    subColor.value = DEFAULTS.color;
    subBg.value = DEFAULTS.bg;
    subBgOpacity.value = DEFAULTS.bgOpacity;
    opacityVal.textContent = '40%';
    subOutline.value = DEFAULTS.outline;
    subOutlineEnabled.checked = DEFAULTS.outlineEnabled;
    subFontSize.value = DEFAULTS.fontSize;
    fontSizeVal.textContent = '100%';
    subOutlineSize.value = DEFAULTS.outlineSize;
    outlineSizeVal.textContent = '2px';
    subPosition.value = DEFAULTS.position;
    positionVal.textContent = '10%';
    signSizeScale.value = DEFAULTS.signSizeScale;
    signSizeVal.textContent = DEFAULTS.signSizeScale + '%';

    [subBgOpacity, subFontSize, subOutlineSize, subPosition, signSizeScale].forEach(setSliderFill);
    syncSwatch(subColor, chipColor);
    syncSwatch(subBg, chipBg);
    syncSwatch(subOutline, chipOutline);
    outlineColorText.textContent = subOutline.value;
    saveStyles();
  });

  masterToggle.addEventListener('change', () => {
    const enabled = masterToggle.checked;
    setEnabledUI(enabled);
    if (enabled) {
      const mode = currentMode();
      chrome.storage.local.set({ subMode: mode });
      notifyContentScript({ action: 'MODE_CHANGED', mode });
    } else {
      chrome.storage.local.set({ subMode: 'off' });
      notifyContentScript({ action: 'MODE_CHANGED', mode: 'off' });
    }
  });

  function handleModeChange() {
    const mode = currentMode();
    applyMode(mode);
    chrome.storage.local.set({ subMode: mode });
    if (masterToggle.checked) {
      notifyContentScript({ action: 'MODE_CHANGED', mode });
    }
    renderSyncValue();
  }
  radioAuto.addEventListener('change', handleModeChange);
  radioLocal.addEventListener('change', handleModeChange);
  radioOriginal.addEventListener('change', handleModeChange);

  function handleLanguageChange() {
    if (!sourceLang.value || !targetLang.value) return;

    savedSourceLang = sourceLang.value;
    savedTargetLang = targetLang.value;
    chrome.storage.local.set({
      sourceLang: savedSourceLang,
      targetLang: savedTargetLang
    });
    notifyContentScript({
      action: 'LANG_CHANGED',
      sourceLang: savedSourceLang,
      targetLang: savedTargetLang
    });
    updateLanguageHint();
    renderSyncValue();
  }

  sourceLang.addEventListener('change', handleLanguageChange);
  targetLang.addEventListener('change', handleLanguageChange);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.sourceLang && changes.sourceLang.newValue) {
      savedSourceLang = changes.sourceLang.newValue;
      if ([...sourceLang.options].some(option => option.value === savedSourceLang)) {
        sourceLang.value = savedSourceLang;
      }
      renderSyncValue();
    }
    if (changes.targetLang && changes.targetLang.newValue) {
      savedTargetLang = changes.targetLang.newValue;
      if ([...targetLang.options].some(option => option.value === savedTargetLang)) {
        targetLang.value = savedTargetLang;
      }
    }
    if (changes.availableLangs) {
      populateSourceLanguages(changes.availableLangs.newValue || []);
      requestAvailableLanguages();
    }
    if (changes.localFileName) {
      savedLocalFileName = changes.localFileName.newValue || '';
      renderSyncValue();
    }
    if (changes.syncOffsets) {
      syncOffsets = changes.syncOffsets.newValue && typeof changes.syncOffsets.newValue === 'object'
        ? changes.syncOffsets.newValue
        : {};
      renderSyncValue();
    }
    if (changes.subStyles && changes.subStyles.newValue) {
      const styles = changes.subStyles.newValue;
      if (styles.signSizeScale !== undefined) {
        signSizeScale.value = styles.signSizeScale;
        signSizeVal.textContent = styles.signSizeScale + '%';
      }
    }
    updateLanguageHint();
  });

  syncOffset.addEventListener('change', (e) => {
    persistSyncValue(normalizeSyncOffset(parseFloat(e.target.value)));
  });

  [[syncMinusCoarse, -1], [syncMinusFine, -0.1], [syncPlusFine, 0.1], [syncPlusCoarse, 1]].forEach(([button, delta]) => {
    button.addEventListener('click', () => applySyncDelta(delta));
  });

  btnSyncReset.addEventListener('click', () => {
    persistSyncValue(0);
  });

  btnBrowse.addEventListener('click', () => fileUpload.click());
  fileUpload.addEventListener('change', handleFileSelect);

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
  });
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
  });
  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
  });
  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      fileUpload.files = files;
      handleFileSelect({ target: { files: files } });
    }
  });

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.endsWith('.srt') && !file.name.endsWith('.vtt')) {
      fileStatus.textContent = 'Formato no soportado. Usa .srt o .vtt';
      fileStatus.style.color = 'var(--danger)';
      return;
    }
    const reader = new FileReader();
    reader.onload = function (event) {
      const content = event.target.result;
      chrome.storage.local.set({ localFileName: file.name, localFileContent: content }, () => {
        savedLocalFileName = file.name;
        renderSyncValue();
        fileStatus.textContent = `Archivo: ${file.name}`;
        fileStatus.style.color = 'var(--ok)';
        notifyContentScript({ action: 'NEW_SUBTITLES_LOADED', fileName: file.name, content: content });
      });
    };
    reader.readAsText(file);
  }

  function requestAvailableLanguages() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id || !tab.url || !tab.url.includes('crunchyroll.com')) return;

      chrome.tabs.sendMessage(tab.id, { action: 'GET_AVAILABLE_LANGS' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && Array.isArray(response.availableLangs)) {
          populateSourceLanguages(response.availableLangs);
        }
      });
    });
  }

  function notifyContentScript(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes('crunchyroll.com')) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {
          console.log('Could not send message to content script');
        });
      }
    });
  }
});
