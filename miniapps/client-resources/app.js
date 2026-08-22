import { mountNetworkMotion } from '../shared/motion.js';
import { mountPageLifecycle, mountShell } from '../shared/shell.js';

const SUPPORTED_LANGUAGES = new Set(['en', 'es-MX']);

function hasExactKeys(value, keys) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function isShortText(value, maxLength) {
  return typeof value === 'string'
    && value.trim() === value
    && value.length > 0
    && value.length <= maxLength;
}

export function isClientResourceDocument(value, expectedLanguage) {
  if (!hasExactKeys(value, ['schemaVersion', 'locale', 'title', 'introduction', 'sections'])) return false;
  if (value.schemaVersion !== 1 || value.locale !== expectedLanguage) return false;
  if (!isShortText(value.title, 120) || !isShortText(value.introduction, 500)) return false;
  if (!Array.isArray(value.sections) || value.sections.length < 1 || value.sections.length > 8) return false;

  return value.sections.every((section) => (
    hasExactKeys(section, ['id', 'title', 'summary', 'items'])
    && typeof section.id === 'string'
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(section.id)
    && isShortText(section.title, 120)
    && isShortText(section.summary, 500)
    && Array.isArray(section.items)
    && section.items.length >= 1
    && section.items.length <= 12
    && section.items.every((item) => isShortText(item, 500))
  ));
}

export async function requestClientResources({ fetchImpl, language }) {
  const selectedLanguage = SUPPORTED_LANGUAGES.has(language) ? language : 'en';
  const response = await fetchImpl(`./api/resources/?lang=${encodeURIComponent(selectedLanguage)}`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  if (response.status === 401) return { kind: 'unauthorized' };
  if (!response.ok) return { kind: 'error' };

  try {
    const content = await response.json();
    const csrfToken = response.headers?.get?.('X-CaboHealth-CSRF-Token') ?? '';
    return isClientResourceDocument(content, selectedLanguage) && /^[A-Za-z0-9_-]{32,256}$/u.test(csrfToken)
      ? { kind: 'ready', content, csrfToken }
      : { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}

export async function requestEndClientSession({ fetchImpl, csrfToken }) {
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(csrfToken)) return { kind: 'error' };
  const response = await fetchImpl('./api/session/', {
    method: 'DELETE',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'X-CSRF-Token': csrfToken,
    },
  });
  if (response.status === 204) return { kind: 'ended' };
  if (response.status === 401) return { kind: 'unauthorized' };
  return { kind: 'error' };
}

function stateCopy(kind, language) {
  const spanish = language === 'es-MX';
  const copy = {
    loading: spanish
      ? ['Verificando acceso', 'Espera un momento mientras confirmamos esta sesión.']
      : ['Checking access', 'Please wait while we confirm this session.'],
    unauthorized: spanish
      ? ['La sesión terminó', 'Vuelve a abrir este recurso desde la app CaboHealth.']
      : ['Session ended', 'Reopen this resource from the CaboHealth app.'],
    error: spanish
      ? ['No pudimos cargar los recursos', 'Intenta abrir este recurso de nuevo desde la app.']
      : ['Resources could not load', 'Try opening this resource again from the app.'],
  };
  return copy[kind] ?? copy.error;
}

export function renderClientResources({ page, result, language }) {
  const status = page.querySelector('[data-resource-status]');
  const statusTitle = page.querySelector('[data-resource-status-title]');
  const statusMessage = page.querySelector('[data-resource-status-message]');
  const contentRegion = page.querySelector('[data-resource-content]');
  const sessionActions = page.querySelector('[data-session-actions]');
  const endSession = page.querySelector('[data-end-session]');
  if (!status || !statusTitle || !statusMessage || !contentRegion) return;

  contentRegion.replaceChildren();
  if (result.kind !== 'ready') {
    const [title, message] = stateCopy(result.kind, language);
    statusTitle.textContent = title;
    statusMessage.textContent = message;
    status.hidden = false;
    contentRegion.hidden = true;
    if (sessionActions) sessionActions.hidden = true;
    if (endSession) endSession.disabled = true;
    return;
  }

  const heading = page.createElement('div');
  heading.className = 'section-heading';
  const eyebrow = page.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = language === 'es-MX' ? 'Biblioteca para clientes' : 'Client library';
  const title = page.createElement('h2');
  title.textContent = result.content.title;
  const introduction = page.createElement('p');
  introduction.textContent = result.content.introduction;
  heading.append(eyebrow, title, introduction);
  contentRegion.append(heading);

  const grid = page.createElement('div');
  grid.className = 'client-resource-grid';
  for (const section of result.content.sections) {
    const article = page.createElement('article');
    article.className = 'information-panel client-resource-panel';
    const sectionTitle = page.createElement('h3');
    sectionTitle.textContent = section.title;
    const summary = page.createElement('p');
    summary.textContent = section.summary;
    const list = page.createElement('ul');
    for (const item of section.items) {
      const listItem = page.createElement('li');
      listItem.textContent = item;
      list.append(listItem);
    }
    article.append(sectionTitle, summary, list);
    grid.append(article);
  }
  contentRegion.append(grid);
  status.hidden = true;
  contentRegion.hidden = false;
  if (sessionActions) sessionActions.hidden = false;
  if (endSession) endSession.disabled = false;
}

export function mountClientResources({ page, view, storage, fetchImpl }) {
  const shell = mountShell({ document: page, storage });
  const motion = mountNetworkMotion({ document: page, language: shell.getLanguage });
  const listeners = new AbortController();
  const endSession = page.querySelector('[data-end-session]');
  const sessionActionStatus = page.querySelector('[data-session-action-status]');
  let requestSequence = 0;
  let activeCsrfToken = '';

  async function load() {
    const sequence = ++requestSequence;
    const language = shell.getLanguage();
    renderClientResources({ page, result: { kind: 'loading' }, language });
    let result;
    try {
      result = await requestClientResources({ fetchImpl, language });
    } catch {
      result = { kind: 'error' };
    }
    if (sequence === requestSequence) {
      activeCsrfToken = result.kind === 'ready' ? result.csrfToken : '';
      if (sessionActionStatus) sessionActionStatus.textContent = '';
      renderClientResources({ page, result, language });
    }
  }

  async function endActiveSession() {
    if (!endSession || endSession.disabled || activeCsrfToken === '') return;
    endSession.disabled = true;
    if (sessionActionStatus) {
      sessionActionStatus.textContent = shell.getLanguage() === 'es-MX'
        ? 'Cerrando sesión…'
        : 'Ending session…';
    }
    let result;
    try {
      result = await requestEndClientSession({ fetchImpl, csrfToken: activeCsrfToken });
    } catch {
      result = { kind: 'error' };
    }
    if (result.kind === 'ended' || result.kind === 'unauthorized') {
      activeCsrfToken = '';
      renderClientResources({ page, result: { kind: 'unauthorized' }, language: shell.getLanguage() });
      return;
    }
    endSession.disabled = false;
    if (sessionActionStatus) {
      sessionActionStatus.textContent = shell.getLanguage() === 'es-MX'
        ? 'No se pudo cerrar la sesión. Inténtalo de nuevo.'
        : 'The session could not be ended. Try again.';
    }
  }

  page.addEventListener('cabohealth:languagechange', load, { signal: listeners.signal });
  endSession?.addEventListener('click', endActiveSession, { signal: listeners.signal });
  void load();

  return mountPageLifecycle({ view, onDestroy: () => {
    requestSequence += 1;
    activeCsrfToken = '';
    listeners.abort();
    motion.destroy();
    shell.destroy();
  } });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  mountClientResources({
    page: document,
    view: window,
    storage: window.localStorage,
    fetchImpl: window.fetch.bind(window),
  });
}
