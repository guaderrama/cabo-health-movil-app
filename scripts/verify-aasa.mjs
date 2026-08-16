import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalAasaBytes, readReleaseIdentity } from './generate-aasa.mjs';

const EXPECTED_ASSOCIATED_DOMAINS = ['applinks:cabohealth.org'];
const EXPECTED_APP_BOUND_DOMAINS = ['cabohealth.org'];

function skipWhitespace(state) {
  while (/\s/u.test(state.text[state.index] ?? '')) state.index += 1;
}

function parseStringToken(state) {
  const start = state.index;
  state.index += 1;
  while (state.index < state.text.length) {
    const character = state.text[state.index];
    if (character === '\\') {
      state.index += 2;
    } else if (character === '"') {
      state.index += 1;
      return JSON.parse(state.text.slice(start, state.index));
    } else {
      state.index += 1;
    }
  }
  throw new Error('Unterminated JSON string.');
}

function parseValueForDuplicateKeys(state) {
  skipWhitespace(state);
  const character = state.text[state.index];
  if (character === '{') {
    state.index += 1;
    const keys = new Set();
    skipWhitespace(state);
    if (state.text[state.index] === '}') {
      state.index += 1;
      return;
    }
    while (state.index < state.text.length) {
      skipWhitespace(state);
      if (state.text[state.index] !== '"') throw new Error('Invalid JSON object key.');
      const key = parseStringToken(state);
      if (keys.has(key)) throw new Error('Duplicate JSON object key.');
      keys.add(key);
      skipWhitespace(state);
      if (state.text[state.index] !== ':') throw new Error('Invalid JSON object.');
      state.index += 1;
      parseValueForDuplicateKeys(state);
      skipWhitespace(state);
      if (state.text[state.index] === '}') {
        state.index += 1;
        return;
      }
      if (state.text[state.index] !== ',') throw new Error('Invalid JSON object separator.');
      state.index += 1;
    }
    throw new Error('Unterminated JSON object.');
  }
  if (character === '[') {
    state.index += 1;
    skipWhitespace(state);
    if (state.text[state.index] === ']') {
      state.index += 1;
      return;
    }
    while (state.index < state.text.length) {
      parseValueForDuplicateKeys(state);
      skipWhitespace(state);
      if (state.text[state.index] === ']') {
        state.index += 1;
        return;
      }
      if (state.text[state.index] !== ',') throw new Error('Invalid JSON array separator.');
      state.index += 1;
    }
    throw new Error('Unterminated JSON array.');
  }
  if (character === '"') {
    parseStringToken(state);
    return;
  }
  const token = /^[^\s,\]}]+/u.exec(state.text.slice(state.index))?.[0];
  if (!token) throw new Error('Invalid JSON value.');
  state.index += token.length;
}

function assertNoDuplicateKeys(text) {
  const state = { text, index: 0 };
  parseValueForDuplicateKeys(state);
  skipWhitespace(state);
  if (state.index !== text.length) throw new Error('Trailing JSON content.');
}

export function verifyAasa(filePath, root = process.cwd()) {
  const fileBytes = readFileSync(filePath);
  if (fileBytes[0] === 0xef && fileBytes[1] === 0xbb && fileBytes[2] === 0xbf) {
    throw new Error('AASA must not contain a BOM.');
  }

  const text = fileBytes.toString('utf8');
  JSON.parse(text);
  assertNoDuplicateKeys(text);

  const { app, appId } = readReleaseIdentity(root);
  assert.deepStrictEqual(
    app?.expo?.ios?.associatedDomains,
    EXPECTED_ASSOCIATED_DOMAINS,
    'Expo associatedDomains must exactly match the approved array.',
  );
  assert.deepStrictEqual(
    app?.expo?.ios?.infoPlist?.WKAppBoundDomains,
    EXPECTED_APP_BOUND_DOMAINS,
    'Expo WKAppBoundDomains must exactly match the approved array.',
  );
  assert.equal(text, canonicalAasaBytes(appId), 'AASA bytes are not canonical.');
}

try {
  verifyAasa(resolve(
    process.argv[2]
      ?? 'web-hosting/cabohealth.org/.well-known/apple-app-site-association',
  ));
  console.log('Canonical apple-app-site-association verified.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'AASA verification failed.');
  process.exitCode = 1;
}
