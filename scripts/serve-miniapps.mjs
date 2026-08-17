import { createServer } from 'node:http';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, parse, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertSafeMiniappOutputPath,
  MINIAPP_SECURITY_HEADERS,
  readVerifiedMiniappArtifact,
  verifyBuiltArtifact,
} from './build-miniapps.mjs';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

function hasSafeRootAncestry(outputRoot) {
  const temporaryRoot = resolve(tmpdir());
  const tempRelation = relative(temporaryRoot, outputRoot);
  const anchor = tempRelation === '' || (!tempRelation.startsWith('..') && !parse(tempRelation).root)
    ? temporaryRoot
    : parse(outputRoot).root;
  const relation = relative(anchor, outputRoot);
  let current = anchor;
  for (const component of relation.split(/[\\/]/u).filter(Boolean)) {
    current = join(current, component);
    if (!existsSync(current)) return false;
    const stats = lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return false;
  }
  return true;
}

export function normalizeStaticRequestTarget(requestTarget) {
  if (
    typeof requestTarget !== 'string'
    || !requestTarget.startsWith('/')
    || requestTarget.startsWith('//')
    || /[\u0000-\u001f\u007f\\]/u.test(requestTarget)
    || /%(?:2e|2f|5c|00)/iu.test(requestTarget)
  ) return null;

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(new URL(requestTarget, 'http://miniapps.local').pathname);
  } catch {
    return null;
  }
  if (decodedPath.split('/').includes('..') || decodedPath.includes('\\')) return null;
  const relativePath = decodedPath.endsWith('/') ? `${decodedPath.slice(1)}index.html` : decodedPath.slice(1);
  if (!relativePath || relativePath.split('/').some((part) => !part || part.startsWith('.'))) return null;
  return relativePath;
}

export function resolveStaticRequest(root, requestTarget) {
  const outputRoot = resolve(root);
  const relativePath = normalizeStaticRequestTarget(requestTarget);
  if (!relativePath) return null;
  if (!hasSafeRootAncestry(outputRoot)) return null;
  const rootStats = existsSync(outputRoot) ? lstatSync(outputRoot) : null;
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) return null;
  const realOutputRoot = realpathSync(outputRoot);
  const candidate = resolve(outputRoot, relativePath);
  const relation = relative(outputRoot, candidate);
  if (!relation || relation.startsWith('..') || relation.includes('..')) return null;

  let current = outputRoot;
  const components = relation.split(/[\\/]/u);
  for (const [index, component] of components.entries()) {
    current = join(current, component);
    if (!existsSync(current)) return null;
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) return null;
    const final = index === components.length - 1;
    if ((final && !stats.isFile()) || (!final && !stats.isDirectory())) return null;
  }
  const realCandidate = realpathSync(candidate);
  const realRelation = relative(realOutputRoot, realCandidate);
  if (!realRelation || realRelation.startsWith('..') || realRelation.includes('..')) return null;
  return candidate;
}

export function loadVerifiedArtifactSnapshot({
  projectRoot,
  root,
  afterArtifactVerification = () => {},
}) {
  const outputRoot = assertSafeMiniappOutputPath({ projectRoot, outputRoot: root });
  verifyBuiltArtifact({ projectRoot, outputRoot });
  afterArtifactVerification({ outputRoot });
  const artifact = readVerifiedMiniappArtifact({ projectRoot, outputRoot });

  const files = new Map();
  for (const [path, bytes] of artifact.files) {
    if (path === 'apps/.htaccess') continue;
    files.set(path, Object.freeze({
      bytes: Buffer.from(bytes),
      contentType: MIME_TYPES[extname(path)] ?? 'application/octet-stream',
    }));
  }

  return Object.freeze({
    lookup(requestTarget) {
      const relativePath = normalizeStaticRequestTarget(requestTarget);
      const item = relativePath ? files.get(relativePath) ?? null : null;
      return item ? Object.freeze({ ...item, bytes: Buffer.from(item.bytes) }) : null;
    },
    read(requestTarget) {
      const item = this.lookup(requestTarget);
      return item?.bytes ?? null;
    },
  });
}

function writeResponse(response, status, headers, body) {
  response.writeHead(status, { ...MINIAPP_SECURITY_HEADERS, ...headers });
  response.end(body);
}

export function createMiniappsServer({ projectRoot, root }) {
  const resolvedProjectRoot = projectRoot ?? resolve(fileURLToPath(new URL('..', import.meta.url)));
  const snapshot = loadVerifiedArtifactSnapshot({ projectRoot: resolvedProjectRoot, root });
  return createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      writeResponse(response, 405, {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8',
      }, request.method === 'HEAD' ? undefined : 'Method Not Allowed\n');
      return;
    }
    const artifact = snapshot.lookup(request.url ?? '');
    if (!artifact) {
      writeResponse(response, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, request.method === 'HEAD' ? undefined : 'Not Found\n');
      return;
    }
    writeResponse(response, 200, {
      'Content-Type': artifact.contentType,
      'Content-Length': artifact.bytes.byteLength,
      'Cache-Control': 'no-store',
    }, request.method === 'HEAD' ? undefined : artifact.bytes);
  });
}

function runCli() {
  const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const root = join(projectRoot, 'miniapps/dist');
  const portArgument = process.argv.find((argument) => argument.startsWith('--port='));
  const port = portArgument ? Number(portArgument.slice('--port='.length)) : 4173;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  const server = createMiniappsServer({ projectRoot, root });
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const activePort = typeof address === 'object' && address ? address.port : port;
    console.log(`Task 6A preview: http://127.0.0.1:${activePort}/apps/healthy-recipes/`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
