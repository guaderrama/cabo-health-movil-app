import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('the staff build has a restrictive CSP and emits no source maps', () => {
  const html = read('index.html');
  const headers = read('public/_headers');
  const apache = read('public/.htaccess');
  const vite = read('vite.config.ts');
  const deploymentConfig = read('src/firebase/staffFirebaseConfig.ts');

  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /default-src 'none'/u);
  assert.match(html, /object-src 'none'/u);
  assert.doesNotMatch(html, /'unsafe-inline'|'unsafe-eval'/u);
  assert.match(html, /__CABOHEALTH_FUNCTIONS_ORIGIN__/u);
  assert.match(headers, /frame-ancestors 'none'/u);
  assert.match(headers, /X-Content-Type-Options:\s*nosniff/u);
  assert.match(headers, /Cache-Control:\s*no-store/u);
  assert.match(apache, /Header always set Content-Security-Policy/u);
  assert.match(apache, /frame-ancestors 'none'/u);
  assert.match(apache, /Header always set X-Content-Type-Options "nosniff"/u);
  assert.match(apache, /Header always set Cache-Control "no-store"/u);
  assert.match(apache, /Header always set Referrer-Policy "no-referrer"/u);
  assert.match(apache, /Header always set Permissions-Policy/u);
  assert.match(apache, /__CABOHEALTH_FUNCTIONS_ORIGIN__/u);
  assert.doesNotMatch(apache, /'unsafe-inline'|'unsafe-eval'|https:\/\/\*/u);
  assert.match(vite, /sourcemap:\s*false/u);
  assert.match(vite, /outDir:\s*'dist'/u);
  assert.match(deploymentConfig, /invalid\.invalid/u);
  assert.match(deploymentConfig, /cloudfunctions\.net/u);
  assert.match(deploymentConfig, /\^cabohealth-/u);
  assert.match(deploymentConfig, /WEB_APP_ID_PATTERN/u);
  assert.match(deploymentConfig, /authDomain !== `\$\{projectId\}\.firebaseapp\.com`/u);
  assert.match(deploymentConfig, /functionsRegion !== STAFF_FUNCTIONS_REGION/u);
  assert.doesNotMatch(read('dist/.htaccess'), /__CABOHEALTH_FUNCTIONS_ORIGIN__|https:\/\/\*/u);
  assert.match(read('dist/.htaccess'), /https:\/\/invalid\.invalid/u);
  assert.doesNotMatch(read('dist/_headers'), /__CABOHEALTH_FUNCTIONS_ORIGIN__|https:\/\/\*/u);
  assert.doesNotMatch(read('dist/index.html'), /__CABOHEALTH_FUNCTIONS_ORIGIN__|https:\/\/\*/u);
  assert.equal(readdirSync('dist', { recursive: true }).some((path) => String(path).endsWith('.map')), false);
});

test('the portal owns its web dependencies and root scripts only delegate by prefix', () => {
  const rootPackage = JSON.parse(read('../package.json'));
  const rootTypeScript = JSON.parse(read('../tsconfig.json'));
  const staffPackage = JSON.parse(read('package.json'));

  assert.equal(rootPackage.scripts['staff:build'], 'npm --prefix staff-portal run build');
  assert.equal(rootPackage.scripts['staff:test'], 'npm --prefix staff-portal test');
  assert.equal(rootPackage.devDependencies.vite, undefined);
  assert.equal(rootPackage.devDependencies['@types/react-dom'], undefined);
  assert.ok(rootTypeScript.exclude.includes('staff-portal'));
  assert.equal(staffPackage.dependencies.firebase, '12.8.0');
  assert.equal(staffPackage.devDependencies.vite, '7.3.6');
  assert.ok(read('package-lock.json').includes('"lockfileVersion"'));
});
