const LANGUAGE_STORAGE_KEY = 'cabohealth.web.language.v1';
const SUPPORTED_LANGUAGES = new Set(['en', 'es-MX']);
const EMBEDDED_PRESENTATIONS = new Map([
  ['#embedded-en', Object.freeze({ language: 'en', reducedEffects: false })],
  ['#embedded-en-reduced', Object.freeze({ language: 'en', reducedEffects: true })],
  ['#embedded-es-MX', Object.freeze({ language: 'es-MX', reducedEffects: false })],
  ['#embedded-es-MX-reduced', Object.freeze({ language: 'es-MX', reducedEffects: true })],
]);

function safeStorage(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
    ? storage
    : null;
}

function browserLanguage(value) {
  return typeof value === 'string' && value.toLowerCase().split('-')[0] === 'es' ? 'es-MX' : 'en';
}

function readStoredLanguage(storage, navigatorLanguage) {
  try {
    const value = safeStorage(storage)?.getItem(LANGUAGE_STORAGE_KEY);
    return SUPPORTED_LANGUAGES.has(value) ? value : browserLanguage(navigatorLanguage);
  } catch {
    return browserLanguage(navigatorLanguage);
  }
}

function persistLanguage(storage, language) {
  try {
    safeStorage(storage)?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Local persistence is optional; the visible language still changes.
  }
}

export function mountPageLifecycle({ view, onDestroy } = {}) {
  if (!view?.addEventListener || !view?.removeEventListener || typeof onDestroy !== 'function') {
    return { destroy: () => {} };
  }
  let active = true;

  function destroy() {
    if (!active) return;
    active = false;
    view.removeEventListener('pagehide', onPageHide);
    onDestroy();
  }

  function onPageHide(event) {
    if (event?.persisted) return;
    destroy();
  }

  view.addEventListener('pagehide', onPageHide);
  return { destroy };
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
  const localizedLabelledRegions = [...page.querySelectorAll('[data-labelledby-en][data-labelledby-es]')];
  const localizedAriaLabels = [...page.querySelectorAll('[data-aria-label-en][data-aria-label-es]')];
  const embeddedPresentation = EMBEDDED_PRESENTATIONS.get(page.defaultView?.location?.hash);
  let language = embeddedPresentation?.language
    ?? readStoredLanguage(storage, page.defaultView?.navigator?.language);
  if (embeddedPresentation) {
    page.documentElement.dataset.presentation = 'embedded';
    page.documentElement.dataset.reducedEffects = String(embeddedPresentation.reducedEffects);
  }

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
    for (const region of localizedLabelledRegions) {
      const labelledBy = language === 'es-MX' ? region.dataset.labelledbyEs : region.dataset.labelledbyEn;
      if (labelledBy) region.setAttribute('aria-labelledby', labelledBy);
    }
    for (const element of localizedAriaLabels) {
      const label = language === 'es-MX' ? element.dataset.ariaLabelEs : element.dataset.ariaLabelEn;
      if (label) element.setAttribute('aria-label', label);
    }
    for (const button of languageButtons) {
      const selected = button.dataset.language === language;
      button.disabled = false;
      button.setAttribute('aria-pressed', String(selected));
    }
    for (const link of page.querySelectorAll('[data-external-action]')) {
      const actionLabel = language === 'es-MX' ? link.dataset.labelEs : link.dataset.labelEn;
      const externalLabel = language === 'es-MX'
        ? 'Se abre fuera de CaboHealth'
        : 'Opens outside CaboHealth';
      const visibleLabel = link.querySelector('[data-external-label]');
      if (actionLabel && visibleLabel) visibleLabel.textContent = actionLabel;
      if (actionLabel) link.setAttribute('aria-label', `${actionLabel}. ${externalLabel}`);
      link.setAttribute('aria-description', externalLabel);
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
      delete page.documentElement.dataset.presentation;
      delete page.documentElement.dataset.reducedEffects;
    },
  };
}
