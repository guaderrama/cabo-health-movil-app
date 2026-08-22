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
