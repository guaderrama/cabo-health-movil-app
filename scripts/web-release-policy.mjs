const URL_ATTRIBUTES = Object.freeze([
  Object.freeze(['img', 'src']),
  Object.freeze(['img', 'srcset']),
  Object.freeze(['source', 'src']),
  Object.freeze(['source', 'srcset']),
  Object.freeze(['video', 'src']),
  Object.freeze(['video', 'poster']),
  Object.freeze(['audio', 'src']),
  Object.freeze(['track', 'src']),
  Object.freeze(['link', 'href']),
  Object.freeze(['script', 'src']),
  Object.freeze(['iframe', 'src']),
  Object.freeze(['embed', 'src']),
  Object.freeze(['object', 'data']),
  Object.freeze(['form', 'action']),
  Object.freeze(['input', 'src']),
  Object.freeze(['input', 'formaction']),
  Object.freeze(['button', 'formaction']),
  Object.freeze(['use', 'href']),
  Object.freeze(['use', 'xlink:href']),
  Object.freeze(['image', 'href']),
  Object.freeze(['image', 'xlink:href']),
  Object.freeze(['a', 'ping']),
  Object.freeze(['area', 'ping']),
  Object.freeze(['base', 'href']),
  Object.freeze(['body', 'background']),
  Object.freeze(['table', 'background']),
  Object.freeze(['td', 'background']),
  Object.freeze(['th', 'background']),
]);

function tags(text, name) {
  return text.match(new RegExp(`<${name}\\b[^>]*>`, 'giu')) ?? [];
}

function attribute(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu').exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function urlCandidates(attributeName, value) {
  if (attributeName !== 'srcset') return [value];
  return value.split(',').map((candidate) => candidate.trim().split(/\s+/u, 1)[0]);
}

function isReviewedLocalUrl(value) {
  if (!value || /[\u0000-\u001f\u007f]/u.test(value) || value.startsWith('//')) return false;
  if (value.startsWith('https://cabohealth.org/')) return true;
  if (value.startsWith('/')) return true;
  return !/^[a-z][a-z0-9+.-]*:/iu.test(value) && !value.includes('\\');
}

export function assertStaticWebPolicy(path, bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error(`WEB_STATIC_POLICY_BYTES_INVALID: ${path}`);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`WEB_STATIC_POLICY_UTF8_INVALID: ${path}`);
  for (const [tagName, attributeName] of URL_ATTRIBUTES) {
    for (const tag of tags(text, tagName)) {
      const value = attribute(tag, attributeName);
      if (value === null) continue;
      for (const candidate of urlCandidates(attributeName, value)) {
        if (!isReviewedLocalUrl(candidate)) {
          throw new Error(`WEB_ACTIVE_RESOURCE_FORBIDDEN: ${path}: ${tagName}[${attributeName}]`);
        }
      }
    }
  }
  for (const tag of tags(text, 'meta')) {
    if (attribute(tag, 'http-equiv')?.toLowerCase() === 'refresh') {
      throw new Error(`WEB_ACTIVE_RESOURCE_FORBIDDEN: ${path}: meta[refresh]`);
    }
  }
  if (/@import\s+(?:url\()?\s*["']?(?:https?:|\/\/)|url\(\s*["']?(?:https?:|\/\/)|http:\/\//iu.test(text)) {
    throw new Error(`WEB_ACTIVE_RESOURCE_FORBIDDEN: ${path}: css-url`);
  }
  return true;
}
