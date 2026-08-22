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
  const rootPackage = JSON.parse(read('../package.json'));
  const staffPackage = JSON.parse(read('package.json'));
  const runbook = read('../docs/operations/staff-portal-release.md');

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
  assert.match(deploymentConfig, /authDomain !== `\$\{expectedProjectId\}\.firebaseapp\.com`/u);
  assert.match(deploymentConfig, /functionsRegion !== STAFF_FUNCTIONS_REGION/u);
  assert.match(vite, /APP_ENV/u);
  assert.match(vite, /STAFF_EXPECTED_FIREBASE_PROJECT_ID/u);
  assert.match(vite, /STAFF_EXPECTED_FIREBASE_WEB_APP_ID/u);
  assert.match(vite, /STAFF_WEB_FIREBASE_APP_ID/u);
  assert.match(vite, /staff-release/u);
  assert.match(vite, /staff-build-identity\.json/u);
  assert.equal(rootPackage.scripts['staff:build'], 'npm --prefix staff-portal run build:release');
  assert.equal(staffPackage.scripts['release:artifact'], 'node scripts/create-release-artifact.mjs');
  assert.equal(staffPackage.scripts['release:verify-live'], 'node scripts/verify-live-release.mjs');
  assert.match(runbook, /separate from.*cabohealth-public-web-v1/isu);
  assert.match(runbook, /STAFF_WEB_FIREBASE_APP_ID/u);
  assert.match(runbook, /expectedArtifactSha256/u);
  assert.match(runbook, /HTML, JavaScript, CSS, and the protected 404 fallback/iu);
  assert.match(read('public/.htaccess'), /ErrorDocument 404 \/staff\/404\.html/u);
  assert.match(read('public/.htaccess'), /\[R=404,L\]/u);
  assert.deepEqual(JSON.parse(read('dist/staff-build-identity.json')), {
    schemaVersion: 1,
    status: 'closed',
  });
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

  assert.equal(rootPackage.scripts['staff:build'], 'npm --prefix staff-portal run build:release');
  assert.equal(rootPackage.scripts['staff:test'], 'npm --prefix staff-portal test');
  assert.equal(rootPackage.devDependencies.vite, undefined);
  assert.equal(rootPackage.devDependencies['@types/react-dom'], undefined);
  assert.ok(rootTypeScript.exclude.includes('staff-portal'));
  assert.equal(staffPackage.dependencies.firebase, '12.8.0');
  assert.equal(staffPackage.devDependencies.vite, '7.3.6');
  assert.ok(read('package-lock.json').includes('"lockfileVersion"'));
});
