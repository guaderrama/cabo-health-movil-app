import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifierPath = fileURLToPath(new URL('../scripts/verify-minimal-v1.mjs', import.meta.url));

function writeFixtureFile(root, relativePath, contents) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function makePublicReleaseFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cabohealth-minimal-v1-'));
  writeFixtureFile(root, 'app/(main)/index.tsx', 'export default function Home() { return null; }\n');
  writeFixtureFile(
    root,
    'constants/publicMiniapps.ts',
    [
      "export const PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide'] as const;",
      "const privacy = 'https://cabohealth.org/app/privacy/';",
      "const terms = 'https://cabohealth.org/app/terms/';",
      "const support = 'https://cabohealth.org/app/support/';",
      "const reportContent = 'https://cabohealth.org/app/report-content/';",
      "export const PUBLIC_MINIAPPS = [{ slug: 'healthy-recipes' }, { slug: 'clinic-guide' }];",
      'void privacy; void terms; void support; void reportContent;',
      '',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    'web-hosting/cabohealth.org/.well-known/apple-app-site-association',
    JSON.stringify({ applinks: { details: [{ components: [{ '/': '/apps/healthy-recipes/*' }, { '/': '/apps/clinic-guide/*' }] }] } }),
  );
  writeFixtureFile(root, 'release/web-artifacts.json', JSON.stringify({ slugs: ['healthy-recipes', 'clinic-guide'] }));
  return root;
}

function runVerifier(root) {
  return spawnSync(process.execPath, [verifierPath, root], { encoding: 'utf8' });
}

function withFixture(mutate, assertion) {
  const root = makePublicReleaseFixture();
  try {
    mutate(root);
    assertion(runVerifier(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('release scope verifier accepts a two-module public release artifact', () => {
  withFixture(
    () => {},
    (result) => {
      assert.equal(result.status, 0, result.stderr || result.stdout);
    },
  );
});

test('release scope verifier rejects removed routes and unapproved module metadata', () => {
  withFixture(
    (root) => {
      writeFixtureFile(root, 'app/(auth)/access-code.tsx', 'export default null;\n');
      writeFixtureFile(root, 'app/(main)/admin.tsx', 'export default null;\n');
      writeFixtureFile(root, 'release/web-artifacts.json', JSON.stringify({ slugs: ['healthy-recipes', 'clinic-guide', 'client-resources'] }));
    },
    (result) => {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /legacy auth route/i);
      assert.match(result.stderr, /admin route/i);
      assert.match(result.stderr, /unapproved miniapp slug.*client-resources/i);
    },
  );
});

test('release scope verifier rejects a third slug in the catalog or AASA artifact', () => {
  withFixture(
    (root) => {
      writeFixtureFile(
        root,
        'constants/publicMiniapps.ts',
        "export const PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide', 'client-resources'] as const;\nexport const PUBLIC_MINIAPPS = [{ slug: 'healthy-recipes' }, { slug: 'clinic-guide' }];\nconst privacy = 'https://cabohealth.org/app/privacy/'; const terms = 'https://cabohealth.org/app/terms/'; const support = 'https://cabohealth.org/app/support/'; const reportContent = 'https://cabohealth.org/app/report-content/';\nvoid privacy; void terms; void support; void reportContent;\n",
      );
      writeFixtureFile(
        root,
        'web-hosting/cabohealth.org/.well-known/apple-app-site-association',
        JSON.stringify({ applinks: { details: [{ components: [{ '/': '/apps/healthy-recipes/*' }, { '/': '/apps/clinic-guide/*' }, { '/': '/apps/client-resources/*' }] }] } }),
      );
    },
    (result) => {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unapproved miniapp slug in catalog.*client-resources/i);
      assert.match(result.stderr, /unapproved miniapp slug in AASA.*client-resources/i);
    },
  );
});

test('release scope verifier rejects reachable legacy imports and unsafe WebView controls', () => {
  withFixture(
    (root) => {
      writeFixtureFile(root, 'hooks/useCatalog.ts', "import { getFirestore } from 'firebase/firestore';\n");
      writeFixtureFile(root, 'app/(main)/web.tsx', "const bridge = 'onMessage'; const url = 'javascript:alert(1)';\n");
    },
    (result) => {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /legacy access-code, biometry, Firebase, or Firestore import/i);
      assert.match(result.stderr, /forbidden WebView bridge control/i);
      assert.match(result.stderr, /forbidden URL scheme/i);
    },
  );
});

test('release scope verifier rejects a legacy named import re-exported through a barrel', () => {
  withFixture(
    (root) => {
      writeFixtureFile(root, 'app/(main)/settings.tsx', "import { useBiometry } from '../../hooks';\nvoid useBiometry;\n");
    },
    (result) => {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /legacy access-code, biometry, Firebase, or Firestore import/i);
    },
  );
});

test('release scope verifier rejects arbitrary endpoints, insecure production URLs, and missing legal links', () => {
  withFixture(
    (root) => {
      writeFixtureFile(root, 'constants/api.ts', "const endpoint = process.env.EXPO_PUBLIC_CATALOG_URL; const legacy = 'http://cabohealth.org/';\n");
      writeFixtureFile(root, 'constants/publicMiniapps.ts', "export const PUBLIC_MINIAPPS = [{ slug: 'healthy-recipes' }, { slug: 'clinic-guide' }];\n");
    },
    (result) => {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /arbitrary EXPO_PUBLIC_.*URL/i);
      assert.match(result.stderr, /insecure production URL/i);
      assert.match(result.stderr, /missing legal URL.*privacy/i);
      assert.match(result.stderr, /missing legal URL.*report content/i);
    },
  );
});
