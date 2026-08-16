import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const APPROVED_SLUGS = new Set(['healthy-recipes', 'clinic-guide']);
const SOURCE_DIRECTORIES = ['app', 'components', 'constants', 'context', 'hooks', 'features'];
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const LEGAL_URLS = {
  Privacy: 'https://cabohealth.org/app/privacy/',
  Terms: 'https://cabohealth.org/app/terms/',
  Support: 'https://cabohealth.org/app/support/',
  'Report Content': 'https://cabohealth.org/app/report-content/',
};

function walk(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(filePath.slice(filePath.lastIndexOf('.')));
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function addUnexpectedSlugs(errors, source, slugs) {
  for (const slug of slugs) {
    if (!APPROVED_SLUGS.has(slug)) {
      errors.push(`Unapproved miniapp slug in ${source}: ${slug}`);
    }
  }
}

function extractCatalogSlugs(source) {
  const objectSlugs = [...source.matchAll(/\bslug\s*:\s*['"]([a-z0-9-]+)['"]/g)].map((match) => match[1]);
  const canonicalList = source.match(/\bPUBLIC_MINIAPP_SLUGS\s*=\s*\[([^\]]*)\]/);
  const listSlugs = canonicalList
    ? [...canonicalList[1].matchAll(/['"]([a-z0-9-]+)['"]/g)].map((match) => match[1])
    : [];
  return [...objectSlugs, ...listSlugs];
}

function extractAasaSlugs(source) {
  return [...source.matchAll(/\/apps\/([a-z0-9-]+)\/(?:\*|(?=["'}\],\s]|$))/g)].map((match) => match[1]);
}

function isSlugBearingKey(key) {
  return /(?:^|[-_])(?:slug|slugs|miniapps?)(?:$|[-_])|(?:Slug|Miniapp)/.test(key);
}

function collectMetadataSlugs(value, slugs, key = '') {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMetadataSlugs(item, slugs, key);
    }
  } else if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectMetadataSlugs(childValue, slugs, childKey);
    }
  } else if (typeof value === 'string') {
    if (isSlugBearingKey(key) && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(value)) {
      slugs.push(value);
    }
    for (const match of value.matchAll(/\/apps\/([a-z0-9-]+)\/(?:\*|(?=["'}\],\s]|$))/g)) {
      slugs.push(match[1]);
    }
  }
}

function hasForbiddenUrlScheme(source) {
  const literals = [];
  let index = 0;

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (current === '/' && next === '/') {
      index = source.indexOf('\n', index + 2);
      if (index === -1) break;
      continue;
    }
    if (current === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (current !== "'" && current !== '"' && current !== '`') {
      index += 1;
      continue;
    }

    const quote = current;
    let literal = '';
    index += 1;
    while (index < source.length && source[index] !== quote) {
      if (source[index] === '\\' && index + 1 < source.length) {
        literal += source[index + 1];
        index += 2;
      } else {
        literal += source[index];
        index += 1;
      }
    }
    if (source[index] === quote) {
      literals.push(literal);
      index += 1;
    }
  }

  return literals.some((literal) => /^\s*(?:javascript|data|file|content|intent):/i.test(literal));
}

function verify(root) {
  const errors = [];
  const appRoot = join(root, 'app');
  const authRoot = join(appRoot, '(auth)');
  const adminRoute = join(appRoot, '(main)', 'admin.tsx');

  for (const route of walk(authRoot)) {
    errors.push(`Legacy auth route is still packaged: ${relative(root, route)}`);
  }
  if (existsSync(adminRoute)) {
    errors.push(`Admin route is still packaged: ${relative(root, adminRoute)}`);
  }

  const scopedSourceFiles = SOURCE_DIRECTORIES
    .flatMap((directory) => walk(join(root, directory)))
    .filter(isSourceFile);
  const sourceText = scopedSourceFiles.map((filePath) => ({ filePath, text: readText(filePath) }));

  for (const { filePath, text } of sourceText) {
    const location = relative(root, filePath);
    const imports = text.match(/\bimport(?:[\s\S]{0,500}?\sfrom\s*)?['"][^'"]+['"]/g) ?? [];
    if (imports.some((statement) => /(?:access[-_ ]?code|biometr\w*|firebase|firestore)/i.test(statement))) {
      errors.push(`Legacy access-code, biometry, Firebase, or Firestore import is reachable from ${location}`);
    }
    if (/\b(?:onMessage|injectedJavaScript)\b/.test(text)) {
      errors.push(`Forbidden WebView bridge control in ${location}`);
    }
    if (/\bEXPO_PUBLIC_[A-Z0-9_]*URL\b/.test(text)) {
      errors.push(`Arbitrary EXPO_PUBLIC_*URL endpoint in ${location}`);
    }
    if (/http:\/\//i.test(text)) {
      errors.push(`Insecure production URL in ${location}`);
    }
    if (hasForbiddenUrlScheme(text)) {
      errors.push(`Forbidden URL scheme in ${location}`);
    }
  }

  const catalogPath = join(root, 'constants', 'publicMiniapps.ts');
  if (existsSync(catalogPath)) {
    addUnexpectedSlugs(errors, 'catalog', extractCatalogSlugs(readText(catalogPath)));
  }

  for (const aasaPath of walk(root).filter((filePath) => basename(filePath) === 'apple-app-site-association')) {
    addUnexpectedSlugs(errors, 'AASA', extractAasaSlugs(readText(aasaPath)));
  }

  for (const metadataDirectory of ['release', 'miniapps']) {
    for (const metadataPath of walk(join(root, metadataDirectory)).filter((filePath) => filePath.endsWith('.json'))) {
      try {
        const slugs = [];
        collectMetadataSlugs(JSON.parse(readText(metadataPath)), slugs);
        addUnexpectedSlugs(errors, 'release metadata', slugs);
      } catch {
        errors.push(`Invalid release metadata JSON: ${relative(root, metadataPath)}`);
      }
    }
  }

  const packagedText = sourceText.map(({ text }) => text).join('\n');
  for (const [label, url] of Object.entries(LEGAL_URLS)) {
    if (!packagedText.includes(url)) {
      errors.push(`Missing legal URL: ${label}`);
    }
  }

  return errors;
}

const root = resolve(process.argv[2] ?? process.cwd());
if (!statSync(root).isDirectory()) {
  throw new Error(`Verification root is not a directory: ${root}`);
}

const errors = verify(root);
if (errors.length > 0) {
  console.error(errors.map((error) => `FAIL: ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Minimal public v1 release scope verified.');
}
