import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const verifierPath = fileURLToPath(new URL('../scripts/verify-minimal-v1.mjs', import.meta.url));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function writeFixtureFile(root, relativePath, contents) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function verifiedComplianceFacts() {
  return {
    schemaVersion: 1,
    brand: 'CaboHealth',
    releaseReady: true,
    slice: 'task-7b-verified',
    legalEntity: {
      name: 'Cabo Health',
      nameStatus: 'owner-confirmed',
      legalSignOffStatus: 'approved',
    },
    appStore: {
      seller: { value: 'Cabo Health', status: 'verified' },
      sellerRelationship: { value: 'legal-healthcare-provider', status: 'verified' },
    },
    hosting: {
      provider: 'Hostinger',
      logTypes: { value: ['HTTP access log'], status: 'verified' },
      retention: { value: { description: 'Verified retention policy' }, status: 'verified' },
      deletionProcess: { value: { description: 'Verified deletion process' }, status: 'verified' },
    },
    support: {
      contactFactsRef: 'release/public-contact-facts.json',
      responseSla: { value: { description: 'Verified response policy' }, status: 'verified' },
    },
    contentRights: {
      value: { approved: true, scope: 'Verified public-v1 content and assets' },
      status: 'verified',
    },
    exportCompliance: {
      value: { approved: true, determination: 'Verified export determination' },
      status: 'verified',
    },
    medicalDevice: {
      value: { isMedicalDevice: false, basis: 'Verified final-build determination' },
      status: 'verified',
    },
    ageRating: {
      host: { value: 4, status: 'verified' },
      miniapps: {
        'healthy-recipes': { value: 4, status: 'verified' },
        'clinic-guide': { value: 4, status: 'verified' },
      },
    },
    phiRemediation: {
      value: { completed: true, evidenceRef: 'authorized-private-remediation-record' },
      status: 'verified',
    },
  };
}

function writeComplianceFixture(root, facts) {
  writeFixtureFile(root, 'release/compliance-facts.json', JSON.stringify(facts));
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
      "export const PUBLIC_MINIAPPS = [{ slug: 'healthy-recipes', appStoreAgeRating: 4 }, { slug: 'clinic-guide', appStoreAgeRating: 4 }];",
      'void privacy; void terms; void support; void reportContent;',
      '',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    'web-hosting/cabohealth.org/.well-known/apple-app-site-association',
    JSON.stringify({ applinks: { details: [{ components: [{ '/': '/apps/healthy-recipes/' }, { '/': '/apps/clinic-guide/' }] }] } }),
  );
  writeFixtureFile(root, 'release/web-artifacts.json', JSON.stringify({ slugs: ['healthy-recipes', 'clinic-guide'] }));
  writeComplianceFixture(root, verifiedComplianceFacts());
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

test('actual Expo route inventory packages no legacy auth or admin screen', () => {
  for (const route of [
    'app/(auth)/_layout.tsx',
    'app/(auth)/access-code.tsx',
    'app/(auth)/biometry.tsx',
    'app/(auth)/code-expired.tsx',
    'app/(main)/admin.tsx',
  ]) {
    assert.equal(existsSync(join(projectRoot, route)), false, `${route} must not be packaged`);
  }
});

test('actual public Expo config requests no biometric capability', () => {
  const appConfig = JSON.parse(readFileSync(join(projectRoot, 'app.json'), 'utf8'));
  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));

  assert.equal('NSFaceIDUsageDescription' in appConfig.expo.ios.infoPlist, false);
  assert.deepEqual(appConfig.expo.android.permissions ?? [], []);
  assert.equal(appConfig.expo.plugins.includes('expo-local-authentication'), false);
  assert.equal('expo-local-authentication' in packageJson.dependencies, false);
});

test('actual A4 intro reuses the native animation stack without a new runtime engine', () => {
  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));

  for (const dependency of [
    'moti',
    'lottie-react-native',
    '@shopify/react-native-skia',
    'framer-motion',
    'gsap',
  ]) {
    assert.equal(dependency in packageJson.dependencies, false, `${dependency} must not ship for A4`);
  }
});

test('runtime config exposes only public local-state settings and no remote catalog endpoint', async () => {
  const configSource = readFileSync(join(projectRoot, 'constants/config.ts'), 'utf8');
  const compiledConfig = ts.transpileModule(configSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const { config } = await import(
    `data:text/javascript;base64,${Buffer.from(compiledConfig).toString('base64')}`
  );

  assert.equal('firebase' in config, false);
  assert.equal('collections' in config, false);
  assert.deepEqual(config.storageKeys, {
    favorites: '@cabohealth_favorites',
    favoritesOrder: '@cabohealth_favorites_order',
    language: '@cabohealth_language',
    hapticEnabled: '@cabohealth_haptic_enabled',
    reducedEffects: '@cabohealth_reduced_effects',
    hasSeenOnboarding: '@cabohealth_has_seen_onboarding',
  });
});

test('release scope verifier accepts a two-module public release artifact', () => {
  withFixture(
    () => {},
    (result) => {
      assert.equal(result.status, 0, result.stderr || result.stdout);
    },
  );
});

test('release scope verifier rejects every malformed or contradictory compliance mutation', async (t) => {
  const mutations = [
    ['unknown root key', (facts) => { facts.unexpected = 'accepted'; }],
    ['wrong schema version', (facts) => { facts.schemaVersion = 2; }],
    ['wrong brand', (facts) => { facts.brand = 'Cabo Health'; }],
    ['release-ready wrong type', (facts) => { facts.releaseReady = 'true'; }],
    ['empty slice', (facts) => { facts.slice = ''; }],
    ['unknown legal entity key', (facts) => { facts.legalEntity.unexpected = true; }],
    ['wrong legal entity name', (facts) => { facts.legalEntity.name = 'Fixture Company'; }],
    ['wrong legal entity name status', (facts) => { facts.legalEntity.nameStatus = 'verified'; }],
    ['unknown app-store key', (facts) => { facts.appStore.unexpected = true; }],
    ['unknown hosting key', (facts) => { facts.hosting.unexpected = true; }],
    ['unknown support key', (facts) => { facts.support.unexpected = true; }],
    ['unknown age-rating key', (facts) => { facts.ageRating.unexpected = true; }],
    ['unknown gate key', (facts) => { facts.appStore.seller.unexpected = 'accepted'; }],
    ['contradictory pending gate', (facts) => { facts.appStore.seller.pending = true; }],
    ['empty seller', (facts) => { facts.appStore.seller.value = ''; }],
    ['healthcare seller does not match entity', (facts) => { facts.appStore.seller.value = 'Another Seller'; }],
    ['unsupported seller relationship', (facts) => { facts.appStore.sellerRelationship.value = 'fixture-relationship'; }],
    ['wrong hosting provider', (facts) => { facts.hosting.provider = 'Fixture Hosting'; }],
    ['empty log types', (facts) => { facts.hosting.logTypes.value = []; }],
    ['blank log type', (facts) => { facts.hosting.logTypes.value = [' ']; }],
    ['empty retention description', (facts) => { facts.hosting.retention.value.description = '  '; }],
    ['unknown retention value key', (facts) => { facts.hosting.retention.value.unexpected = true; }],
    ['wrong deletion value type', (facts) => { facts.hosting.deletionProcess.value = 'deleted'; }],
    ['wrong contact facts reference', (facts) => { facts.support.contactFactsRef = 'release/other.json'; }],
    ['empty response policy', (facts) => { facts.support.responseSla.value.description = ''; }],
    ['unapproved content rights', (facts) => { facts.contentRights.value.approved = false; }],
    ['unapproved export determination', (facts) => { facts.exportCompliance.value.approved = false; }],
    ['empty medical-device basis', (facts) => { facts.medicalDevice.value.basis = ''; }],
    ['false PHI remediation', (facts) => { facts.phiRemediation = { value: false, status: 'verified' }; }],
    ['incomplete PHI remediation object', (facts) => { facts.phiRemediation.value = { completed: true }; }],
    ['unknown PHI remediation value key', (facts) => { facts.phiRemediation.value.unexpected = true; }],
    ['string host rating', (facts) => {
      facts.ageRating.host.value = 'not-a-rating';
      facts.ageRating.miniapps['healthy-recipes'].value = 'not-a-rating';
      facts.ageRating.miniapps['clinic-guide'].value = 'not-a-rating';
    }],
    ['fractional rating', (facts) => { facts.ageRating.host.value = 4.5; }],
    ['rating below range', (facts) => { facts.ageRating.host.value = 3; }],
    ['rating above range', (facts) => { facts.ageRating.host.value = 19; }],
    ['miniapp rating above host', (facts) => { facts.ageRating.miniapps['healthy-recipes'].value = 9; }],
    ['unknown miniapp rating key', (facts) => { facts.ageRating.miniapps.unexpected = { value: 4, status: 'verified' }; }],
    ['catalog rating left null', (facts, root) => {
      writeFixtureFile(
        root,
        'constants/publicMiniapps.ts',
        "export const PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide'] as const;\nconst privacy = 'https://cabohealth.org/app/privacy/'; const terms = 'https://cabohealth.org/app/terms/'; const support = 'https://cabohealth.org/app/support/'; const reportContent = 'https://cabohealth.org/app/report-content/';\nexport const PUBLIC_MINIAPPS = [{ slug: 'healthy-recipes', appStoreAgeRating: null }, { slug: 'clinic-guide', appStoreAgeRating: null }];\nvoid privacy; void terms; void support; void reportContent;\n",
      );
    }],
    ['catalog rating is fractional', (facts, root) => {
      writeFixtureFile(
        root,
        'constants/publicMiniapps.ts',
        "export const PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide'] as const;\nconst privacy = 'https://cabohealth.org/app/privacy/'; const terms = 'https://cabohealth.org/app/terms/'; const support = 'https://cabohealth.org/app/support/'; const reportContent = 'https://cabohealth.org/app/report-content/';\nexport const PUBLIC_MINIAPPS = [{ slug: 'healthy-recipes', appStoreAgeRating: 4.5 }, { slug: 'clinic-guide', appStoreAgeRating: 4 }];\nvoid privacy; void terms; void support; void reportContent;\n",
      );
    }],
    ['catalog duplicates an approved slug', (facts, root) => {
      writeFixtureFile(
        root,
        'constants/publicMiniapps.ts',
        "export const PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide'] as const;\nconst privacy = 'https://cabohealth.org/app/privacy/'; const terms = 'https://cabohealth.org/app/terms/'; const support = 'https://cabohealth.org/app/support/'; const reportContent = 'https://cabohealth.org/app/report-content/';\nexport const PUBLIC_MINIAPPS = [{ slug: 'healthy-recipes', appStoreAgeRating: 4 }, { slug: 'healthy-recipes', appStoreAgeRating: 4 }, { slug: 'clinic-guide', appStoreAgeRating: 4 }];\nvoid privacy; void terms; void support; void reportContent;\n",
      );
    }],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      withFixture(
        (root) => {
          const facts = verifiedComplianceFacts();
          mutate(facts, root);
          writeComplianceFixture(root, facts);
        },
        (result) => assert.equal(result.status, 1, `${name} bypassed verifier:\n${result.stdout}${result.stderr}`),
      );
    });
  }
});

test('release scope verifier accepts benign data and content object properties', () => {
  withFixture(
    (root) => {
      writeFixtureFile(root, 'components/editorial.ts', "export const editorialCard = { data: [], content: 'CaboHealth editorial content' };\n");
    },
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

test('release scope verifier rejects an exact third AASA miniapp path', () => {
  withFixture(
    (root) => {
      writeFixtureFile(
        root,
        'web-hosting/cabohealth.org/.well-known/apple-app-site-association',
        JSON.stringify({ applinks: { details: [{ components: [{ '/': '/apps/healthy-recipes/' }, { '/': '/apps/clinic-guide/' }, { '/': '/apps/client-resources/' }] }] } }),
      );
    },
    (result) => {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unapproved miniapp slug in AASA.*client-resources/i);
    },
  );
});

test('release scope verifier rejects a third slug in arbitrary release metadata containers', () => {
  withFixture(
    (root) => {
      writeFixtureFile(root, 'release/web-artifacts.json', JSON.stringify({ miniapps: ['healthy-recipes', 'clinic-guide', 'client-resources'] }));
    },
    (result) => {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unapproved miniapp slug in release metadata.*client-resources/i);
    },
  );
});

test('release scope verifier accepts non-slug kebab-case release metadata', () => {
  withFixture(
    (root) => {
      writeFixtureFile(
        root,
        'release/web-artifacts.json',
        JSON.stringify({ release: { contentDescriptors: ['health-and-wellness-information'], dataUse: ['technical-request-logs'] } }),
      );
    },
    (result) => {
      assert.equal(result.status, 0, result.stderr || result.stdout);
    },
  );
});

test('release scope verifier accepts descriptive miniapp metadata keys', () => {
  withFixture(
    (root) => {
      writeFixtureFile(
        root,
        'release/web-artifacts.json',
        JSON.stringify({
          'miniapp-description': 'health-and-wellness-information',
          miniapp_metadata: 'technical-request-logs',
          publicMiniappDescription: 'health-and-wellness-information',
        }),
      );
    },
    (result) => {
      assert.equal(result.status, 0, result.stderr || result.stdout);
    },
  );
});

test('release scope verifier rejects explicit slug-bearing metadata fields', () => {
  withFixture(
    (root) => {
      writeFixtureFile(
        root,
        'release/web-artifacts.json',
        JSON.stringify({
          slug: 'client-resources',
          slugs: ['client-resources'],
          miniapp: 'client-resources',
          miniapps: ['client-resources'],
          miniApps: ['client-resources'],
          moduleSlug: 'client-resources',
          module_slugs: ['client-resources'],
          'module-slug': 'client-resources',
        }),
      );
    },
    (result) => {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unapproved miniapp slug in release metadata.*client-resources/i);
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
