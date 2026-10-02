#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as FS_CONSTANTS,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CANDIDATE,
  EAS_ACCOUNT,
  EAS_PROJECT_SLUG,
  UUID_PATTERN,
  canonicalJsonBytes,
  fsyncDirectory,
  isCanonicalUtc,
  parseJsonBytes,
  readStdinBounded,
  validateOwnedDirectory,
  writeExclusiveCanonicalJson,
} from './release-evidence-common.mjs';

const CODE = 'EAS_ARTIFACT_DOWNLOAD_FAILED';
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_IPA_BYTES = 1024 * 1024 * 1024;
const TASK_PARENT = '/.superpowers/sdd/2026-10-01-cabohealth-apple-readiness/task-4-evidence';
const IPA_NAME = 'CaboHealth-3.0-build-14.ipa';

function fail() {
  throw new Error(CODE);
}

function validateBuild(bytes, buildId) {
  const value = parseJsonBytes(bytes, CODE);
  const locator = value.artifacts?.buildUrl;
  const error = value.error === undefined ? null : value.error;
  let url;
  try {
    url = new URL(locator);
  } catch {
    fail();
  }
  if (!UUID_PATTERN.test(buildId ?? '') || value.id !== buildId
    || value.status !== 'FINISHED' || value.platform !== 'IOS'
    || value.distribution !== 'STORE' || value.buildProfile !== 'production'
    || value.appIdentifier !== CANDIDATE.bundleIdentifier
    || value.appVersion !== CANDIDATE.marketingVersion
    || value.appBuildVersion !== CANDIDATE.buildNumber
    || value.app?.slug !== EAS_PROJECT_SLUG
    || value.app?.ownerAccount?.name !== EAS_ACCOUNT
    || !isCanonicalUtc(value.completedAt)
    || error !== null
    || url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') fail();
  return { locator: url.href, reviewedAt: value.completedAt };
}

function requireAbsentOutput(path) {
  let present = false;
  try {
    lstatSync(path);
    present = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') fail();
  }
  if (present) fail();
}

async function writeDownload(response, outputPath) {
  if (response?.status !== 200 || response.body?.getReader === undefined) fail();
  const header = response.headers?.get?.('content-length');
  if (header !== null && header !== undefined
    && (!/^\d+$/u.test(header) || Number(header) <= 0 || Number(header) > MAX_IPA_BYTES)) fail();
  let descriptor;
  let created = false;
  let total = 0;
  const streamedDigest = createHash('sha256');
  const magic = Buffer.alloc(4);
  let magicLength = 0;
  const reader = response.body.getReader();
  try {
    descriptor = openSync(
      outputPath,
      FS_CONSTANTS.O_RDWR | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL
        | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
      0o600,
    );
    created = true;
    fchmodSync(descriptor, 0o600);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail();
      const bytes = Buffer.from(value);
      total += bytes.length;
      if (total > MAX_IPA_BYTES) {
        await reader.cancel();
        fail();
      }
      if (magicLength < 4) {
        const copyLength = Math.min(4 - magicLength, bytes.length);
        bytes.copy(magic, magicLength, 0, copyLength);
        magicLength += copyLength;
      }
      streamedDigest.update(bytes);
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
    }
    fsyncSync(descriptor);
    const stat = fstatSync(descriptor);
    const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== uid
      || (stat.mode & 0o777) !== 0o600 || stat.size !== total || total === 0
      || magicLength !== 4 || !magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) fail();
    const finalDigest = createHash('sha256');
    const readBuffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < total) {
      const bytesRead = readSync(
        descriptor,
        readBuffer,
        0,
        Math.min(readBuffer.length, total - position),
        position,
      );
      if (bytesRead <= 0) fail();
      finalDigest.update(readBuffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const finalSha256 = finalDigest.digest('hex');
    if (finalSha256 !== streamedDigest.digest('hex')) fail();
    closeSync(descriptor);
    descriptor = undefined;
    fsyncDirectory(dirname(outputPath), CODE);
    const finalStat = lstatSync(outputPath);
    if (!finalStat.isFile() || finalStat.isSymbolicLink() || finalStat.dev !== stat.dev
      || finalStat.ino !== stat.ino || finalStat.nlink !== 1 || finalStat.uid !== uid
      || (finalStat.mode & 0o777) !== 0o600 || finalStat.size !== total
      || realpathSync(outputPath) !== outputPath) fail();
    return { byteCount: total, sha256: finalSha256 };
  } catch (error) {
    try { await reader.cancel(); } catch { /* no raw response is retained */ }
    if (created) {
      try {
        unlinkSync(outputPath);
        fsyncDirectory(dirname(outputPath), CODE);
      } catch {
        // The stable download error is preserved; the caller must not proceed.
      }
    }
    if (error instanceof Error && error.message === CODE) throw error;
    fail();
  } finally {
    try { reader.releaseLock(); } catch { /* response cleanup only */ }
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export async function downloadEasArtifact({
  stdinBytes,
  buildId,
  outputPath,
  associationOutputPath,
  now = Date.now,
  fetchImpl = globalThis.fetch,
}) {
  let ipaCreated = false;
  try {
    if (!Buffer.isBuffer(stdinBytes) || stdinBytes.length === 0 || stdinBytes.length > MAX_INPUT_BYTES
      || typeof now !== 'function' || typeof fetchImpl !== 'function'
      || typeof outputPath !== 'string' || !isAbsolute(outputPath) || resolve(outputPath) !== outputPath
      || basename(outputPath) !== IPA_NAME || !dirname(outputPath).endsWith('/rc-build-14')
      || typeof associationOutputPath !== 'string' || !isAbsolute(associationOutputPath)
      || resolve(associationOutputPath) !== associationOutputPath
      || associationOutputPath !== join(dirname(associationOutputPath), 'eas-artifact-association.json')
      || !dirname(associationOutputPath).endsWith(TASK_PARENT)) fail();
    const ipaParent = validateOwnedDirectory(dirname(outputPath), CODE);
    const associationParent = validateOwnedDirectory(dirname(associationOutputPath), CODE);
    requireAbsentOutput(outputPath);
    requireAbsentOutput(associationOutputPath);
    const { locator, reviewedAt: completedAt } = validateBuild(stdinBytes, buildId);
    const response = await fetchImpl(locator, { redirect: 'error' });
    const downloaded = await writeDownload(response, outputPath);
    ipaCreated = true;
    const reviewedAt = now === Date.now ? completedAt : new Date(now()).toISOString();
    if (!isCanonicalUtc(reviewedAt)) fail();
    const association = {
      schemaVersion: 1,
      evidenceKind: 'cabohealth-eas-artifact-association',
      candidate: CANDIDATE,
      easBuildId: buildId,
      account: EAS_ACCOUNT,
      projectSlug: EAS_PROJECT_SLUG,
      platform: 'IOS',
      distribution: 'STORE',
      buildProfile: 'production',
      buildStatus: 'FINISHED',
      artifactAvailable: true,
      downloadedIpaByteCount: downloaded.byteCount,
      downloadedIpaSha256: downloaded.sha256,
      associationGuardProven: false,
      providerUrlsOmitted: true,
      credentialFieldsOmitted: true,
      reviewedAt,
    };
    writeExclusiveCanonicalJson(associationOutputPath, association, CODE, {
      expectedParent: associationParent,
    });
    if (!readFileSync(associationOutputPath).equals(canonicalJsonBytes(association))) fail();
    validateOwnedDirectory(ipaParent, CODE);
    return association;
  } catch (error) {
    if (ipaCreated) {
      try { unlinkSync(outputPath); fsyncDirectory(dirname(outputPath), CODE); } catch { /* preserve failure */ }
    }
    if (error instanceof Error && error.message === CODE) throw error;
    fail();
  }
}

function parseArguments(values) {
  if (values.length !== 6 || values[0] !== '--build-id' || !UUID_PATTERN.test(values[1] ?? '')
    || values[2] !== '--output' || typeof values[3] !== 'string'
    || values[4] !== '--association-output' || typeof values[5] !== 'string') fail();
  return { buildId: values[1], outputPath: values[3], associationOutputPath: values[5] };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const stdinBytes = await readStdinBounded(process.stdin, MAX_INPUT_BYTES, CODE);
  await downloadEasArtifact({ ...options, stdinBytes });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(`${CODE}\n`);
    process.exitCode = 1;
  });
}
