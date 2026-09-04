#!/usr/bin/env node

import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalJsonBytes,
  parseJsonBytes,
  readStdinBounded,
  validateOwnedDirectory,
  writeExclusiveCanonicalJson,
} from './release-evidence-common.mjs';

const CODE = 'EAS_ENVIRONMENT_SANITIZATION_FAILED';
const MAX_INPUT_BYTES = 1024 * 1024;
const TASK_PARENT = '/.superpowers/sdd/2026-09-04-cabohealth-build11-input-authority-recovery/task-3-recovery-evidence';
const UNICODE_WHITESPACE = /[\p{White_Space}\p{Pattern_White_Space}\uFEFF]/u;
const SENSITIVE_VALUE = '***** (This is a sensitive env variable. To access it, run command with --include-sensitive flag. Learn more.)';
const SECRET_VALUE = "***** (This is a secret env variable that can only be accessed on EAS builder and can't be read in any UI. Learn more.)";
const PROJECT_VARIABLES = Object.freeze([
  Object.freeze({
    name: 'CABOHEALTH_FIREBASE_PROJECT_ID',
    visibility: 'SENSITIVE',
    type: 'string',
    value: SENSITIVE_VALUE,
    kind: 'sensitive',
  }),
  Object.freeze({
    name: 'CABOHEALTH_GOOGLE_SERVICES_PLIST',
    visibility: 'SECRET',
    type: 'file',
    value: SECRET_VALUE,
    kind: 'secret-file',
  }),
]);

function fail() {
  throw new Error(CODE);
}

function hasForbiddenTextCharacter(text) {
  for (const character of text) {
    if (character === '\n' || character === ' ') continue;
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || UNICODE_WHITESPACE.test(character)) return true;
  }
  return false;
}

function decodeUtf8(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) fail();
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)
    || hasForbiddenTextCharacter(text)) fail();
  return text;
}

function field(line, label) {
  const match = new RegExp(`^${label} {2,}(.+)$`, 'u').exec(line);
  if (match === null || match[1].trim() !== match[1]) fail();
  return match[1];
}

export function parseEasEnvironmentLongOutput(bytes) {
  const decoded = decodeUtf8(bytes);
  const text = decoded.startsWith('\n') ? decoded.slice(1) : decoded;
  const prefix = 'Environment: production\nVariables for this project:\n';
  if (!text.startsWith(prefix)) fail();
  const body = text.slice(prefix.length).replace(/\n$/u, '');
  const blocks = body.split('\n\n———\n\n');
  if (blocks.length !== PROJECT_VARIABLES.length) fail();

  const records = blocks.map((block) => {
    const lines = block.split('\n');
    if (lines.length !== 9) fail();
    return {
      id: field(lines[0], 'ID'),
      name: field(lines[1], 'Name'),
      value: field(lines[2], 'Value'),
      scope: field(lines[3], 'Scope'),
      visibility: field(lines[4], 'Visibility'),
      environments: field(lines[5], 'Environments'),
      type: field(lines[6], 'type'),
      createdAt: field(lines[7], 'Created at'),
      updatedAt: field(lines[8], 'Updated at'),
    };
  });
  if (new Set(records.map(({ name }) => name)).size !== records.length) fail();
  for (const expected of PROJECT_VARIABLES) {
    const matches = records.filter(({ name }) => name === expected.name);
    if (matches.length !== 1) fail();
    const [record] = matches;
    if (record.value !== expected.value
      || record.scope !== 'PROJECT'
      || record.visibility !== expected.visibility
      || record.environments !== 'production'
      || record.type !== expected.type
      || record.id.length === 0
      || record.createdAt.length === 0
      || record.updatedAt.length === 0) fail();
  }
  if (records.some(({ name }) => !PROJECT_VARIABLES.some((item) => item.name === name))) fail();
  return records;
}

function readConfig(path) {
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) fail();
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path || stat.size > 1024 * 1024) fail();
    const value = parseJsonBytes(readFileSync(path), CODE);
    if (value.build?.production?.environment !== 'production'
      || JSON.stringify(value.build?.production?.env) !== JSON.stringify({ APP_ENV: 'production' })) fail();
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === CODE) throw error;
    fail();
  }
}

export function sanitizeEasEnvironment({
  stdinBytes,
  environmentName,
  easConfigPath,
  outputPath,
}) {
  try {
    if (environmentName !== 'production') fail();
    parseEasEnvironmentLongOutput(stdinBytes);
    readConfig(easConfigPath);
    if (typeof outputPath !== 'string' || !isAbsolute(outputPath) || resolve(outputPath) !== outputPath
      || basename(outputPath) !== 'eas-environment.json'
      || !dirname(outputPath).endsWith(TASK_PARENT)) fail();
    const parent = validateOwnedDirectory(dirname(outputPath), CODE);
    const value = {
      schemaVersion: 1,
      evidenceKind: 'cabohealth-eas-environment-inventory',
      environmentName: 'production',
      profileVariables: [
        { name: 'APP_ENV', source: 'eas-profile', kind: 'plain' },
      ],
      projectVariables: PROJECT_VARIABLES.map(({ name, kind }) => ({
        name,
        source: 'eas-project-environment',
        kind,
      })),
      extras: [],
      valuesIncluded: false,
      providerValuesRetained: false,
    };
    writeExclusiveCanonicalJson(outputPath, value, CODE, { expectedParent: parent });
    if (!readFileSync(outputPath).equals(canonicalJsonBytes(value))) fail();
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === CODE) throw error;
    fail();
  }
}

function parseArguments(values) {
  if (values.length !== 6
    || values[0] !== '--environment' || values[1] !== 'production'
    || values[2] !== '--eas-config' || values[3] !== 'eas.json'
    || values[4] !== '--output' || typeof values[5] !== 'string') fail();
  return { environmentName: values[1], easConfigPath: resolve(values[3]), outputPath: values[5] };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const stdinBytes = await readStdinBounded(process.stdin, MAX_INPUT_BYTES, CODE);
  sanitizeEasEnvironment({ ...options, stdinBytes });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(`${CODE}\n`);
    process.exitCode = 1;
  });
}
