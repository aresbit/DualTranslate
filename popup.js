// Dual Translate - Popup Script
// Bridges the popup UI with the extension's background and content scripts.
//
// IMPORTANT: this extension uses a custom channel-based messaging runtime
// (the "@webext-core/messaging"-style layer bundled in content_main.js /
// background.js). A plain `chrome.tabs.sendMessage({method})` is silently
// ignored by that runtime. Every message must be a wire envelope of the form:
//
//   { to: "<type>:<name>", from: "<type>:<name>", payload: { method, data } }
//
// The receiver validates `to`/`from` are strings and `payload` is an object,
// parses `to` to find the registered subscriber, and dispatches
// `payload.method` to its handler. The reply resolves to `{ ok, data }`.
//
// Verified channels:
//   - content actions  -> "content:main"     (handler dispatches $e[method])
//   - background config -> "background:main"  (getUserConfig / setUserConfig ...)
// Config is persisted under chrome.storage key `fullLocalUserConfig`;
// `setUserConfig` OVERWRITES the whole object, so we get-merge-set.

(function () {
  'use strict';

  // ---- Messaging constants -------------------------------------------------
  const FROM = 'popup:main';
  const CONTENT_TO = 'content:main';
  const BG_TO = 'background:main';

  // Common Google Translate language list used by the extension
  const LANGUAGES = [
    { code: 'auto', name: 'Auto detect' },
    { code: 'en', name: 'English' },
    { code: 'zh-CN', name: 'Chinese (Simplified)' },
    { code: 'zh-TW', name: 'Chinese (Traditional)' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' },
    { code: 'ar', name: 'Arabic' },
    { code: 'hi', name: 'Hindi' },
    { code: 'th', name: 'Thai' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'id', name: 'Indonesian' },
    { code: 'tr', name: 'Turkish' },
    { code: 'pl', name: 'Polish' },
    { code: 'nl', name: 'Dutch' },
    { code: 'sv', name: 'Swedish' },
    { code: 'uk', name: 'Ukrainian' },
    { code: 'he', name: 'Hebrew' },
    { code: 'fa', name: 'Persian' },
    { code: 'ms', name: 'Malay' },
    { code: 'tl', name: 'Filipino' },
    { code: 'ro', name: 'Romanian' },
    { code: 'hu', name: 'Hungarian' },
    { code: 'cs', name: 'Czech' },
    { code: 'el', name: 'Greek' },
    { code: 'da', name: 'Danish' },
    { code: 'fi', name: 'Finnish' },
    { code: 'no', name: 'Norwegian' },
    { code: 'sk', name: 'Slovak' },
    { code: 'bg', name: 'Bulgarian' },
    { code: 'hr', name: 'Croatian' },
    { code: 'sr', name: 'Serbian' },
    { code: 'sl', name: 'Slovenian' },
    { code: 'lt', name: 'Lithuanian' },
    { code: 'lv', name: 'Latvian' },
    { code: 'et', name: 'Estonian' },
    { code: 'ca', name: 'Catalan' },
  ];

  // UI Elements
  const els = {
    loading: document.getElementById('loading'),
    mainContent: document.getElementById('mainContent'),
    toggleTranslate: document.getElementById('toggleTranslate'),
    statusBadge: document.getElementById('statusBadge'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    sourceLang: document.getElementById('sourceLang'),
    targetLang: document.getElementById('targetLang'),
    translationMode: document.getElementById('translationMode'),
    translatePage: document.getElementById('translatePage'),
    showOriginal: document.getElementById('showOriginal'),
  };

  // Local view model. `mode` is a UI concept:
  //   dual/translation -> real config `translationMode`
  //   original         -> "show original" (restorePage), not a stored mode.
  const view = {
    targetLanguage: 'en',
    sourceLanguage: 'auto',
    mode: 'dual',
    pageStatus: 'Original', // Original | Translated | Translating | Error
  };

  // ---- Low-level transport -------------------------------------------------

  async function getActiveTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab && tab.id ? tab.id : null;
  }

  // Send a wire-format message to the active tab's content script.
  async function callContent(method, data) {
    try {
      const tabId = await getActiveTabId();
      if (tabId == null) return null;
      const resp = await chrome.tabs.sendMessage(tabId, {
        to: CONTENT_TO,
        from: FROM,
        payload: { method, data },
      });
      return unwrap(resp);
    } catch (e) {
      // Content script not present on this page (chrome://, store pages, etc.)
      console.warn('[DualTranslate] callContent failed:', method, e);
      return null;
    }
  }

  // Send a wire-format message to the background service worker.
  async function callBackground(method, data) {
    try {
      const resp = await chrome.runtime.sendMessage({
        to: BG_TO,
        from: FROM,
        payload: { method, data },
      });
      return unwrap(resp);
    } catch (e) {
      console.warn('[DualTranslate] callBackground failed:', method, e);
      return null;
    }
  }

  // The messaging runtime wraps replies as { ok, data, errorMessage }.
  function unwrap(resp) {
    if (resp && typeof resp === 'object' && 'ok' in resp) {
      return resp.ok ? resp.data : null;
    }
    return resp;
  }

  // ---- Config (persisted in `fullLocalUserConfig`) -------------------------

  async function getUserConfig() {
    const cfg = await callBackground('getUserConfig');
    return cfg && typeof cfg === 'object' ? cfg : {};
  }

  // setUserConfig overwrites the whole config object, so merge first.
  async function patchUserConfig(patch) {
    const current = await getUserConfig();
    const next = { ...current, ...patch };
    await callBackground('setUserConfig', next);
    return next;
  }

  // ---- High-level actions --------------------------------------------------

  function isTranslated() {
    return view.pageStatus === 'Translated' || view.pageStatus === 'Translating';
  }

  async function refreshPageStatus() {
    const status = await callContent('getPageStatus');
    if (typeof status === 'string') view.pageStatus = status;
    return view.pageStatus;
  }

  async function doTranslate() {
    view.pageStatus = 'Translating';
    updateStatusUI();
    await callContent('translatePage');
    await refreshPageStatus();
    updateStatusUI();
  }

  async function doRestore() {
    await callContent('restorePage');
    view.pageStatus = 'Original';
    updateStatusUI();
  }

  // ---- Init ----------------------------------------------------------------

  async function init() {
    populateLanguages();
    bindEvents();
    await loadState();
    updateUI();
    els.loading.style.display = 'none';
    els.mainContent.style.display = 'block';
  }

  function populateLanguages() {
    const createOption = (lang) => {
      const opt = document.createElement('option');
      opt.value = lang.code;
      opt.textContent = lang.name;
      return opt;
    };
    LANGUAGES.forEach((lang) => {
      if (lang.code !== 'auto') els.sourceLang.appendChild(createOption(lang));
      els.targetLang.appendChild(createOption(lang));
    });
  }

  async function loadState() {
    // Pull real config + live page status in parallel.
    const [cfg] = await Promise.all([getUserConfig(), refreshPageStatus()]);
    if (cfg.targetLanguage) view.targetLanguage = cfg.targetLanguage;
    if (cfg.sourceLanguage) view.sourceLanguage = cfg.sourceLanguage;
    if (cfg.translationMode === 'translation') view.mode = 'translation';
    else if (cfg.translationMode === 'dual') view.mode = 'dual';
  }

  function bindEvents() {
    // Master on/off toggle: translate the current page or restore it.
    els.toggleTranslate.addEventListener('change', async () => {
      if (els.toggleTranslate.checked) {
        await doTranslate();
      } else {
        await doRestore();
      }
    });

    els.sourceLang.addEventListener('change', async () => {
      view.sourceLanguage = els.sourceLang.value;
      await patchUserConfig({ sourceLanguage: view.sourceLanguage });
      if (isTranslated()) await doTranslate(); // re-translate with new source
    });

    els.targetLang.addEventListener('change', async () => {
      view.targetLanguage = els.targetLang.value;
      await patchUserConfig({ targetLanguage: view.targetLanguage });
      if (isTranslated()) await doTranslate(); // re-translate with new target
    });

    els.translationMode.addEventListener('change', async () => {
      view.mode = els.translationMode.value;
      if (view.mode === 'original') {
        await doRestore();
        return;
      }
      // dual | translation -> persist and apply live.
      await patchUserConfig({ translationMode: view.mode });
      if (isTranslated()) {
        await callContent('switchTranslationMode', { mode: view.mode });
      } else {
        await doTranslate();
      }
    });

    els.translatePage.addEventListener('click', async () => {
      els.toggleTranslate.checked = true;
      await doTranslate();
    });

    els.showOriginal.addEventListener('click', async () => {
      els.toggleTranslate.checked = false;
      await doRestore();
    });
  }

  function updateUI() {
    els.sourceLang.value = view.sourceLanguage;
    els.targetLang.value = view.targetLanguage;
    els.translationMode.value = view.mode === 'original' ? 'original' : view.mode;
    els.toggleTranslate.checked = isTranslated();
    updateStatusUI();
  }

  function updateStatusUI() {
    const status = view.pageStatus;
    const active = isTranslated();
    els.statusBadge.className = 'status-badge ' + (active ? 'active' : 'inactive');
    els.statusDot.className = 'status-dot ' + (active ? 'active' : 'inactive');
    const labels = {
      Translated: 'On',
      Translating: '...',
      Original: 'Off',
      Error: 'Error',
    };
    els.statusText.textContent = labels[status] || (active ? 'On' : 'Off');
    els.toggleTranslate.checked = active;
  }

  // Start
  init();
})();
