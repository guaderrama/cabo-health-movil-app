import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const verifierPath = join(projectRoot, 'scripts/verify-release-v3.mjs');

function runVerifier(root = projectRoot) {
  return spawnSync(process.execPath, [verifierPath, root], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cabohealth-release-v3-'));
  for (const path of [
    'app',
    'components',
    'constants',
    'context',
    'features',
    'release',
    'web-hosting',
  ]) {
    cpSync(join(projectRoot, path), join(root, path), { recursive: true });
  }
  for (const path of ['app.json', 'eas.json', 'package.json', 'firebase.json', 'firestore.rules']) {
    cpSync(join(projectRoot, path), join(root, path));
  }
  return root;
}

function mutateJson(root, relativePath, mutate) {
  const path = join(root, relativePath);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  mutate(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function withFixture(mutate, assertion) {
  const root = makeFixture();
  try {
    mutate(root);
    assertion(runVerifier(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('release v3 verifier accepts the truthful draft-blocked 3.0/build 4 package', () => {
  const result = runVerifier();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /verified.*draft-blocked/iu);
});

test('release v3 authorities record the complete age, sanitized audit, and App Review contracts', () => {
  const age = JSON.parse(readFileSync(join(projectRoot, 'release/app-store/3.0/age-rating.json'), 'utf8'));
  const privacy = JSON.parse(readFileSync(join(projectRoot, 'release/app-store/3.0/app-privacy.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'release/app-store/3.0/release-manifest.json'), 'utf8'));

  assert.equal(privacy.recommendedAppPrivacyAnswer, 'Yes, we collect data from this app');
  assert.deepEqual(age.otherSupportedAnswers, {
    parentalControls: false,
    ageAssurance: false,
    userGeneratedContent: false,
    socialMedia: false,
    socialMediaAgeRestricted: false,
    messagingAndChat: false,
    advertising: false,
    profanityOrCrudeHumor: 'NONE',
    horrorOrFearThemes: 'NONE',
    alcoholTobaccoOrDrugUseOrReferences: 'NONE',
    matureOrSuggestiveThemes: 'NONE',
    sexualContentOrNudity: 'NONE',
    sexualContentGraphicAndNudity: 'NONE',
    violenceCartoonOrFantasy: 'NONE',
    violenceRealistic: 'NONE',
    violenceRealisticProlongedGraphicOrSadistic: 'NONE',
    gunsOrOtherWeapons: 'NONE',
    gamblingSimulated: 'NONE',
    contests: 'NONE',
    gambling: false,
    lootBox: false,
  });
  assert.deepEqual(privacy.applicationAudit, {
    retentionDays: 30,
    actorLabel: 'Staff',
    containsActorUid: false,
    containsCodes: false,
    containsResourceUrls: false,
    containsClientNames: false,
  });
  assert.deepEqual(privacy.conditionalRecommendation.provisionalCategoryMapping, [
    'User ID, if the pseudonymous Firebase UID is retained and disclosure is required',
    'Device ID, if the app-installation identifier is retained off device and disclosure is required',
    'Coarse Location, if retained country derived from an IP address is in disclosure scope',
    'Product Interaction, if retained requested-resource activity is in disclosure scope',
    'Performance Data, if retained latency or response-byte measurements are in disclosure scope',
    'Other Diagnostic Data, if retained HTTP method, user-agent, or technical-error records are in disclosure scope',
    'Other Data Types, only if a retained field cannot be accurately mapped to another Apple data type',
  ]);
  assert.deepEqual(
    privacy.conditionalRecommendation.provisionalPurpose,
    ['App Functionality'],
  );
  assert.deepEqual(manifest.reviewCredential, {
    namespace: 'review_sandbox',
    purpose: 'app_review',
    credentialPrefix: 'AR',
    uidRealm: 'review_*',
    multiDevice: true,
    credentialInRepository: false,
    status: 'pending-activation',
    fixedReviewedResourceId: 'review-sandbox-app-review-sample-v1',
    launchMethod: 'POST',
    launchPath: '/apps/app-review/launch/',
  });
});

test('release v3 verifier rejects every non-object JSON authority', async (t) => {
  const authorities = [
    'release/app-store/3.0/release-manifest.json',
    'release/app-store/3.0/age-rating.json',
    'release/app-store/3.0/app-privacy.json',
  ];
  const scalars = ['null', 'false', '0', '[]', '"text"'];
  for (const relativePath of authorities) {
    for (const source of scalars) {
      await t.test(`${relativePath}=${source}`, () => withFixture(
        (root) => writeFileSync(join(root, relativePath), `${source}\n`),
        (result) => {
          assert.equal(result.status, 1, `${relativePath}=${source} bypassed authority validation`);
          assert.match(result.stderr, /must be a JSON object/iu);
        },
      ));
    }
  }
});

test('release v3 verifier keeps the native version authorities untouched before RC', () => {
  withFixture(
    (root) => mutateJson(root, 'app.json', (app) => {
      app.expo.version = '3.0';
      app.expo.ios.buildNumber = '4';
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /app\.json must remain 2\.0\.0\/build 3/iu);
    },
  );
});

test('release v3 verifier rejects non-version app config drift before RC', () => {
  withFixture(
    (root) => mutateJson(root, 'app.json', (app) => {
      app.expo.ios.associatedDomains.push('applinks:unreviewed.example');
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /app\.json must retain the exact reviewed pre-RC bytes/iu);
    },
  );
});

test('release v3 verifier rejects executable config drift hidden behind stale comments', () => {
  withFixture(
    (root) => {
      const path = join(root, 'constants/config.ts');
      const source = readFileSync(path, 'utf8')
        .replace("version: '2.0.0',", "version: '3.0.0',")
        .replace("buildNumber: '1',", "buildNumber: '4',");
      writeFileSync(
        path,
        `${source}\n// Stale reviewed values: version: '2.0.0'; buildNumber: '1'\n`,
      );
    },
    (result) => {
      assert.equal(result.status, 1, `stale comments bypassed config authority:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /constants\/config\.ts.*exact reviewed bytes/iu);
    },
  );
});

test('release v3 verifier rejects executable catalog drift hidden from slug-only checks', async (t) => {
  const mutations = [
    ['allowed path widened', (source) => source
      .replace('allowedPathPrefix: `/apps/${PublicMiniappSlug}/`;', 'allowedPathPrefix: string;')
      .replace("allowedPathPrefix: '/apps/healthy-recipes/',", "allowedPathPrefix: '/',")],
    ['permission and purchase enabled', (source) => source
      .replace('permissions: [];', 'permissions: string[];')
      .replace('hasPurchases: false;', 'hasPurchases: boolean;')
      .replace(
        'permissions: [],\n    hasUserGeneratedContent: false,\n    hasPurchases: false,',
        "permissions: ['camera'],\n    hasUserGeneratedContent: false,\n    hasPurchases: true,",
      )],
    ['third slug hidden behind stale comment', (source) => source.replace(
      "export const PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide'] as const;",
      "// PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide'] as const\nexport const PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide', 'third-public'] as const;",
    )],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => {
        const path = join(root, 'constants/publicMiniapps.ts');
        writeFileSync(path, mutate(readFileSync(path, 'utf8')));
      },
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed catalog authority:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /constants\/publicMiniapps\.ts.*exact reviewed bytes/iu);
      },
    ));
  }
});

test('release v3 verifier fixes two public miniapps plus one protected client resource', () => {
  withFixture(
    (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
      manifest.scope.publicMiniapps.push({
        slug: 'third-public',
        title: 'Third',
        canonicalUrl: 'https://cabohealth.org/apps/third-public/',
        universalLink: 'https://cabohealth.org/apps/third-public/',
      });
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /exactly two public miniapps/iu);
    },
  );
});

test('release v3 verifier rejects protected-resource title or authority drift', async (t) => {
  const mutations = [
    ['title', (resource) => { resource.title = 'Paid Premium Area'; }],
    ['arbitrary links', (resource) => { resource.arbitraryExternalLinksPublished = true; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
        mutate(manifest.scope.protectedResources[0]);
      }),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed protected-resource authority`);
        assert.match(result.stderr, /one server-protected Client Resources surface/iu);
      },
    ));
  }
});

test('release v3 verifier rejects commerce, pricing, checkout, IAP, purchase CTAs, and digital tiers', async (t) => {
  const mutations = [
    ['sale', (model) => { model.sale = true; }],
    ['price', (model) => { model.price = '$9.99'; }],
    ['checkout', (model) => { model.checkout = true; }],
    ['iap', (model) => { model.inAppPurchase = true; }],
    ['cta', (model) => { model.purchaseCta = 'Buy now'; }],
    ['tier', (model) => { model.digitalTier = 'premium'; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
        mutate(manifest.scope.commercialModel);
      }),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /commercial model must remain complimentary/iu);
      },
    ));
  }
});

test('release v3 verifier requires maximum four existing in-person client slots', () => {
  withFixture(
    (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
      manifest.scope.commercialModel.maximumActiveClientCodes = 5;
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /maximumActiveClientCodes must remain 4/iu);
    },
  );
});

test('release v3 verifier requires isolated pending multi-device App Review access', async (t) => {
  const mutations = [
    ['production namespace', (credential) => { credential.namespace = 'production_client'; }],
    ['production credential prefix', (credential) => { credential.credentialPrefix = 'CH'; }],
    ['production UID realm', (credential) => { credential.uidRealm = 'client_*'; }],
    ['single device', (credential) => { credential.multiDevice = false; }],
    ['real credential committed', (credential) => { credential.credentialInRepository = true; }],
    ['premature readiness', (credential) => { credential.status = 'ready'; }],
    ['mutable resource', (credential) => { credential.fixedReviewedResourceId = null; }],
    ['GET launch', (credential) => { credential.launchMethod = 'GET'; }],
    ['production launch path', (credential) => { credential.launchPath = '/apps/client-resources/launch/'; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
        mutate(manifest.reviewCredential);
      }),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /App Review credential must remain isolated.*pending-activation/iu);
      },
    ));
  }
});

test('release v3 verifier requires a 9+ reconfirmation rather than reusing the saved result', () => {
  withFixture(
    (root) => mutateJson(root, 'release/app-store/3.0/age-rating.json', (age) => {
      age.status = 'saved-app-store-calculated';
      age.calculatedRating = '9+';
      age.ownerConfirmationRequired = false;
      age.appStoreCalculationRequired = false;
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Age rating must remain 9\+ reconfirmation-required/iu);
    },
  );
});

test('release v3 verifier requires pseudonymous Firebase, SecureStore, App Check, durable deletion, and 30-day audit', async (t) => {
  const mutations = [
    ['identified account', (privacy) => { privacy.clientAccount.pseudonymous = false; }],
    ['plain installation', (privacy) => { privacy.installation.storage = 'AsyncStorage'; }],
    ['App Check off', (privacy) => { privacy.appCheck.required = false; }],
    ['non-durable deletion', (privacy) => { privacy.deletion.durable = false; }],
    ['long audit', (privacy) => { privacy.applicationAudit.retentionDays = 31; }],
    ['variable audit actor', (privacy) => { privacy.applicationAudit.actorLabel = 'Admin Name'; }],
    ['audit actor UID', (privacy) => { privacy.applicationAudit.containsActorUid = true; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, 'release/app-store/3.0/app-privacy.json', mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /privacy architecture must retain/iu);
      },
    ));
  }
});

test('release v3 verifier requires explicit negative answers for every supported age category', async (t) => {
  const categories = [
    ['parentalControls', true],
    ['ageAssurance', true],
    ['userGeneratedContent', true],
    ['socialMedia', true],
    ['socialMediaAgeRestricted', true],
    ['messagingAndChat', true],
    ['advertising', true],
    ['profanityOrCrudeHumor', 'INFREQUENT'],
    ['horrorOrFearThemes', 'INFREQUENT'],
    ['alcoholTobaccoOrDrugUseOrReferences', 'INFREQUENT'],
    ['matureOrSuggestiveThemes', 'INFREQUENT'],
    ['sexualContentOrNudity', 'INFREQUENT'],
    ['sexualContentGraphicAndNudity', 'INFREQUENT'],
    ['violenceCartoonOrFantasy', 'INFREQUENT'],
    ['violenceRealistic', 'INFREQUENT'],
    ['violenceRealisticProlongedGraphicOrSadistic', 'INFREQUENT'],
    ['gunsOrOtherWeapons', 'INFREQUENT'],
    ['gamblingSimulated', 'INFREQUENT'],
    ['contests', 'INFREQUENT'],
    ['gambling', true],
    ['lootBox', true],
  ];
  for (const [category, changedAnswer] of categories) {
    await t.test(category, () => withFixture(
      (root) => mutateJson(root, 'release/app-store/3.0/age-rating.json', (age) => {
        age.otherSupportedAnswers[category] = changedAnswer;
      }),
      (result) => {
        assert.equal(result.status, 1, `${category}=${changedAnswer} bypassed the age authority`);
        assert.match(result.stderr, /exact age-rating authority|age rating must retain the exact authority schema/iu);
      },
    ));
  }
});

test('release v3 verifier pins the current Apple age questionnaire and override contract', async (t) => {
  const mutations = [
    ['frequency scale', (age) => { age.questionnaireReference.frequencyScale = ['NONE', 'FREQUENT']; }],
    ['health topics presence', (age) => { age.conditions.healthOrWellnessTopics.requiredAnswer = 'FREQUENT'; }],
    ['kids age band', (age) => { age.ageCategoryAndOverride.kidsAgeBand = 'FIVE_AND_UNDER'; }],
    ['age override', (age) => { age.ageCategoryAndOverride.ageRatingOverrideV2 = 'NINE_PLUS'; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, 'release/app-store/3.0/age-rating.json', mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed the age authority`);
        assert.match(result.stderr, /exact age-rating authority|age rating must retain the exact authority schema|Age rating must remain/iu);
      },
    ));
  }
});

test('release v3 verifier keeps every incomplete external step explicitly blocked', () => {
  const manifest = JSON.parse(readFileSync(
    join(projectRoot, 'release/app-store/3.0/release-manifest.json'),
    'utf8',
  ));
  assert.equal(
    manifest.gates.staffReviewAccess,
    'pending-isolated-review-access-or-written-apple-direction',
  );
  assert.equal(
    manifest.appStoreDraft.unresolvedExternalGates.staffReviewAccess,
    'pending-isolated-review-access-or-written-apple-direction',
  );
  withFixture(
    (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
      manifest.gates.firebaseAndHosting = 'ready';
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /release gates must retain every required pending state/iu);
    },
  );
});

test('release v3 verifier requires planned AASA client-resource inclusion and launch/api/staff exclusions', () => {
  withFixture(
    (root) => mutateJson(root, 'release/app-store/3.0/release-manifest.json', (manifest) => {
      manifest.aasaPlan.components.splice(1, 1);
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /AASA plan must retain the ordered launch\/api exclusions and three exact app roots/iu);
    },
  );
});

test('captured release verifier allows reviewed client imports but rejects a third public slug', async () => {
  const { verifyCapturedReleaseV3 } = await import('../scripts/verify-release-v3.mjs');
  const files = new Map([
    ['app.json', Buffer.from(readFileSync(join(projectRoot, 'app.json')))],
    ['constants/config.ts', Buffer.from(readFileSync(join(projectRoot, 'constants/config.ts')))],
    ['constants/publicMiniapps.ts', Buffer.from(readFileSync(join(projectRoot, 'constants/publicMiniapps.ts')))],
    ['release/app-store/3.0/release-manifest.json', Buffer.from(readFileSync(join(projectRoot, 'release/app-store/3.0/release-manifest.json')))],
    ['release/app-store/3.0/age-rating.json', Buffer.from(readFileSync(join(projectRoot, 'release/app-store/3.0/age-rating.json')))],
    ['release/app-store/3.0/app-privacy.json', Buffer.from(readFileSync(join(projectRoot, 'release/app-store/3.0/app-privacy.json')))],
    ['features/clientAccess/clientAccessRuntime.native.ts', Buffer.from("import '@react-native-firebase/auth';\nimport * as SecureStore from 'expo-secure-store';\n")],
  ]);

  assert.deepEqual(verifyCapturedReleaseV3(files), []);
  files.set(
    'constants/publicMiniapps.ts',
    Buffer.from("export const PUBLIC_MINIAPP_SLUGS = ['healthy-recipes', 'clinic-guide', 'third-public'] as const;\n"),
  );
  assert.match(verifyCapturedReleaseV3(files).join('\n'), /exactly two public miniapps/iu);
});

test('captured release verifier rejects unknown authority fields and public-alias drift', async (t) => {
  const mutations = [
    ['manifest root key', 'release/app-store/3.0/release-manifest.json', (value) => {
      value.unreviewed = true;
    }],
    ['public alias drift', 'release/app-store/3.0/release-manifest.json', (value) => {
      value.scope.miniapps[0].title = 'Changed alias';
    }],
    ['age nested key', 'release/app-store/3.0/age-rating.json', (value) => {
      value.conditions.unrestrictedWebAccess.unreviewed = true;
    }],
    ['privacy root key', 'release/app-store/3.0/app-privacy.json', (value) => {
      value.unreviewed = true;
    }],
  ];

  for (const [name, relativePath, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, relativePath, mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed captured authority:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /exact authority schema|public miniapp aliases/iu);
      },
    ));
  }
});

test('captured release verifier rejects semantic drift across every release authority', async (t) => {
  const mutations = [
    ['native bridge', 'release/app-store/3.0/release-manifest.json', (value) => { value.scope.nativeWebBridge = true; }],
    ['staff publishing', 'release/app-store/3.0/release-manifest.json', (value) => { value.scope.staffAdministration.directPublishing = true; }],
    ['staff URL', 'release/app-store/3.0/release-manifest.json', (value) => { value.urls.staff = 'https://evil.example/'; }],
    ['organization seller', 'release/app-store/3.0/release-manifest.json', (value) => { value.ownerSeller.registeredOrganization = true; }],
    ['Apple ID', 'release/app-store/3.0/release-manifest.json', (value) => { value.candidate.appleId = '1'; }],
    ['premature App Store save', 'release/app-store/3.0/release-manifest.json', (value) => { value.appStoreDraft.status = 'saved'; }],
    ['native resource URL', 'release/app-store/3.0/app-privacy.json', (value) => { value.backend.resourceUrlsReturnedToNative = true; }],
    ['debug App Check', 'release/app-store/3.0/app-privacy.json', (value) => { value.appCheck.providers = ['debug']; }],
    ['best-effort deletion', 'release/app-store/3.0/app-privacy.json', (value) => { value.deletion.mechanism = 'best effort'; }],
    ['saved privacy linkage', 'release/app-store/3.0/app-privacy.json', (value) => { value.clientAccount.status = 'saved'; }],
    ['advertising category', 'release/app-store/3.0/app-privacy.json', (value) => { value.conditionalRecommendation.provisionalCategoryMapping = ['Advertising']; }],
    ['advertising age answer', 'release/app-store/3.0/age-rating.json', (value) => { value.otherSupportedAnswers.advertising = true; }],
  ];

  for (const [name, relativePath, mutate] of mutations) {
    await t.test(name, () => withFixture(
      (root) => mutateJson(root, relativePath, mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} semantic drift bypassed captured authority`);
        assert.match(result.stderr, /exact v3 draft semantics|exact privacy authority|exact age-rating authority/iu);
      },
    ));
  }
});
