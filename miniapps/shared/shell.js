const LANGUAGE_STORAGE_KEY = 'cabohealth.web.language.v1';
const SUPPORTED_LANGUAGES = new Set(['en', 'es-MX']);

function safeStorage(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
    ? storage
    : null;
}

function readStoredLanguage(storage) {
  try {
    const value = safeStorage(storage)?.getItem(LANGUAGE_STORAGE_KEY);
    return SUPPORTED_LANGUAGES.has(value) ? value : 'en';
  } catch {
    return 'en';
  }
}

function persistLanguage(storage, language) {
  try {
    safeStorage(storage)?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Local persistence is optional; the visible language still changes.
  }
}

export function mountShell({ document: page, storage } = {}) {
  if (!page?.documentElement) {
    return {
      getLanguage: () => 'en',
      setLanguage: () => {},
      destroy: () => {},
    };
  }

  const listeners = new AbortController();
  const languageButtons = [...page.querySelectorAll('[data-language]')];
  const localizedNodes = [...page.querySelectorAll('[data-locale]')];
  let language = readStoredLanguage(storage);

  function announceLanguageChange() {
    const EventConstructor = page.defaultView?.CustomEvent;
    if (typeof EventConstructor === 'function') {
      page.dispatchEvent(new EventConstructor('cabohealth:languagechange', {
        detail: { language },
      }));
    }
  }

  function setLanguage(nextLanguage, { persist = true, announce = true } = {}) {
    if (!SUPPORTED_LANGUAGES.has(nextLanguage)) return;
    language = nextLanguage;
    page.documentElement.lang = language;
    page.documentElement.dataset.enhanced = 'true';

    for (const node of localizedNodes) {
      node.hidden = node.dataset.locale !== language;
    }
    for (const button of languageButtons) {
      const selected = button.dataset.language === language;
      button.disabled = false;
      button.setAttribute('aria-pressed', String(selected));
    }
    for (const link of page.querySelectorAll('[data-external-action]')) {
      const label = language === 'es-MX'
        ? 'Se abre fuera de CaboHealth'
        : 'Opens outside CaboHealth';
      link.setAttribute('aria-description', label);
    }

    if (persist) persistLanguage(storage, language);
    if (announce) announceLanguageChange();
  }

  function onLanguageClick(event) {
    const button = event.target.closest?.('[data-language]');
    if (!button || !page.contains(button)) return;
    setLanguage(button.dataset.language);
  }

  for (const button of languageButtons) {
    button.addEventListener('click', onLanguageClick, { signal: listeners.signal });
  }
  setLanguage(language, { persist: false, announce: false });

  return {
    getLanguage: () => language,
    setLanguage,
    destroy() {
      listeners.abort();
      delete page.documentElement.dataset.enhanced;
    },
  };
}
