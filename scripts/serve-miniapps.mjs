import { createServer } from 'node:http';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONTENT_SECURITY_POLICY } from './build-miniapps.mjs';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

export function resolveStaticRequest(root, requestTarget) {
  const outputRoot = resolve(root);
  if (
    typeof requestTarget !== 'string'
    || !requestTarget.startsWith('/')
    || requestTarget.startsWith('//')
    || /[\u0000-\u001f\u007f\\]/u.test(requestTarget)
    || /%(?:2e|2f|5c|00)/iu.test(requestTarget)
  ) return null;

  let url;
  let decodedPath;
  try {
    url = new URL(requestTarget, 'http://miniapps.local');
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decodedPath.split('/').includes('..') || decodedPath.includes('\\')) return null;
  const relativePath = decodedPath.endsWith('/') ? `${decodedPath.slice(1)}index.html` : decodedPath.slice(1);
  if (!relativePath || relativePath.split('/').some((part) => !part || part.startsWith('.'))) return null;
  const candidate = resolve(outputRoot, relativePath);
  const relation = relative(outputRoot, candidate);
  if (!relation || relation.startsWith('..') || relation.includes('..')) return null;
  if (!existsSync(candidate)) return null;
  const stats = lstatSync(candidate);
  if (!stats.isFile() || stats.isSymbolicLink()) return null;
  return candidate;
}

export function createMiniappsServer({ root }) {
  const outputRoot = resolve(root);
  return createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method Not Allowed\n');
      return;
    }
    const filePath = resolveStaticRequest(outputRoot, request.url ?? '');
    if (!filePath) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found\n');
      return;
    }
    const body = readFileSync(filePath);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
      'Content-Length': body.byteLength,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
}

function runCli() {
  const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const root = join(projectRoot, 'miniapps/dist');
  if (!existsSync(join(root, 'manifest.json'))) {
    throw new Error('No Task 6A artifact found. Run npm run miniapps:build:healthy first.');
  }
  const portArgument = process.argv.find((argument) => argument.startsWith('--port='));
  const port = portArgument ? Number(portArgument.slice('--port='.length)) : 4173;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  const server = createMiniappsServer({ root });
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
