// Dual Translate - Popup Script
// Bridges the popup UI with the extension's background and content scripts

(function () {
  'use strict';

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

  const STORAGE_KEY = 'dualTranslateConfig';

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
    openSettings: document.getElementById('openSettings'),
  };

  let config = {
    enabled: false,
    sourceLanguage: 'auto',
    targetLanguage: 'en',
    mode: 'dual', // dual | translation | original
  };

  // Initialize
  async function init() {
    populateLanguages();
    await loadConfig();
    bindEvents();
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
      if (lang.code !== 'auto') {
        els.sourceLang.appendChild(createOption(lang));
      }
      els.targetLang.appendChild(createOption(lang));
    });
  }

  async function loadConfig() {
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEY]);
      if (stored[STORAGE_KEY]) {
        config = { ...config, ...stored[STORAGE_KEY] };
      }
      // Also try to sync with extension's native config if available
      const nativeConfig = await getExtensionConfig();
      if (nativeConfig) {
        if (nativeConfig.targetLanguage) config.targetLanguage = nativeConfig.targetLanguage;
        if (nativeConfig.sourceLanguage) config.sourceLanguage = nativeConfig.sourceLanguage;
      }
    } catch (e) {
      console.warn('[DualTranslate] loadConfig failed:', e);
    }
  }

  async function saveConfig() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: config });
    } catch (e) {
      console.warn('[DualTranslate] saveConfig failed:', e);
    }
  }

  async function getExtensionConfig() {
    try {
      const resp = await chrome.runtime.sendMessage({ method: 'getUserConfig' });
      return resp || null;
    } catch (e) {
      return null;
    }
  }

  async function setExtensionConfig(patch) {
    try {
      await chrome.runtime.sendMessage({ method: 'setUserConfig', data: patch });
    } catch (e) {
      console.warn('[DualTranslate] setExtensionConfig failed:', e);
    }
  }

  function bindEvents() {
    els.toggleTranslate.addEventListener('change', async () => {
      config.enabled = els.toggleTranslate.checked;
      updateStatusUI();
      await saveConfig();
      await sendToActiveTab({ method: 'toggleTranslatePage' });
    });

    els.sourceLang.addEventListener('change', async () => {
      config.sourceLanguage = els.sourceLang.value;
      await saveConfig();
      await setExtensionConfig({ sourceLanguage: config.sourceLanguage });
    });

    els.targetLang.addEventListener('change', async () => {
      config.targetLanguage = els.targetLang.value;
      await saveConfig();
      await setExtensionConfig({ targetLanguage: config.targetLanguage });
      // Update context menu text
      await updateToggleMenuText();
    });

    els.translationMode.addEventListener('change', async () => {
      config.mode = els.translationMode.value;
      await saveConfig();
      const methods = {
        dual: 'toggleTranslatePage',
        translation: 'toggleOnlyTransation',
        original: 'restorePage',
      };
      await sendToActiveTab({ method: methods[config.mode] || 'toggleTranslatePage' });
    });

    els.translatePage.addEventListener('click', async () => {
      config.enabled = true;
      updateStatusUI();
      await saveConfig();
      await sendToActiveTab({ method: 'translatePage' });
    });

    els.showOriginal.addEventListener('click', async () => {
      config.enabled = false;
      updateStatusUI();
      await saveConfig();
      await sendToActiveTab({ method: 'restorePage' });
    });

    els.openSettings.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({
          method: 'openOptionsPage',
          data: { newTab: true },
        });
      } catch (e) {
        // Fallback: try chrome.runtime.openOptionsPage
        if (chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        }
      }
    });
  }

  async function updateToggleMenuText() {
    try {
      const langName = LANGUAGES.find((l) => l.code === config.targetLanguage)?.name || config.targetLanguage;
      await chrome.runtime.sendMessage({
        method: 'updateToggleTranslateContextMenu',
        data: { targetLanguage: config.targetLanguage, text: langName },
      });
    } catch (e) {
      // silently fail
    }
  }

  function updateUI() {
    els.toggleTranslate.checked = config.enabled;
    els.sourceLang.value = config.sourceLanguage;
    els.targetLang.value = config.targetLanguage;
    els.translationMode.value = config.mode;
    updateStatusUI();
  }

  function updateStatusUI() {
    const active = config.enabled;
    els.statusBadge.className = 'status-badge ' + (active ? 'active' : 'inactive');
    els.statusDot.className = 'status-dot ' + (active ? 'active' : 'inactive');
    els.statusText.textContent = active ? 'On' : 'Off';
  }

  async function sendToActiveTab(message) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      // Try sending via chrome.tabs.sendMessage (reaches content scripts)
      await chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // If content script is not loaded, try injecting or notify background
        console.warn('[DualTranslate] Content script not ready on tab', tab.id);
      });
    } catch (e) {
      console.warn('[DualTranslate] sendToActiveTab failed:', e);
    }
  }

  // Start
  init();
})();
