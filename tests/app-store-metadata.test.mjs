import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const verifierPath = join(projectRoot, 'scripts/verify-app-store-metadata.mjs');
const releasePath = 'release/app-store/3.0';
const authorityPaths = Object.freeze([
  'app.json',
  'constants/config.ts',
  'constants/publicMiniapps.ts',
  'release/compliance-facts.json',
  'release/content-rights.md',
  'release/data-inventory.md',
  'release/public-contact-facts.json',
]);

function verify(root) {
  return spawnSync(process.execPath, [verifierPath, root], {
    cwd: root,
    encoding: 'utf8',
  });
}

function mutateJson(root, relativePath, mutate) {
  const absolutePath = join(root, relativePath);
  const value = JSON.parse(readFileSync(absolutePath, 'utf8'));
  mutate(value);
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function withReleaseFixture(mutate, assertion) {
  const root = mkdtempSync(join(tmpdir(), 'cabohealth-app-store-metadata-'));
  try {
    cpSync(join(projectRoot, releasePath), join(root, releasePath), { recursive: true });
    for (const relativePath of authorityPaths) {
      const destination = join(root, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(projectRoot, relativePath), destination);
    }
    mutate(root);
    assertion(verify(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('versioned App Store metadata is a valid blocked 3.0 build 4 candidate', () => {
  const result = verify(projectRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /draft verified; submission remains blocked/i);
});

test('metadata verifier rejects a third hosted resource', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/release-manifest.json`, (manifest) => {
      manifest.scope.miniapps.push({
        slug: 'third-module',
        title: 'Third Module',
        canonicalUrl: 'https://cabohealth.org/apps/third-module/',
        universalLink: 'https://cabohealth.org/apps/third-module/',
      });
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /exactly two approved miniapps/i);
    },
  );
});

test('metadata verifier enforces App Store localization limits', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'en-US.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        /(?<=## Subtitle\n)[^\n]+/,
        'This subtitle is intentionally far beyond thirty characters',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /en-US subtitle exceeds 30 characters/i);
    },
  );
});

test('metadata verifier rejects Review Notes that omit a canonical module URL', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replaceAll(
        'https://cabohealth.org/apps/clinic-guide/',
        'https://cabohealth.org/apps/healthy-recipes/',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Review Notes missing canonical URL.*clinic-guide/i);
    },
  );
});

test('metadata verifier rejects an arbitrary third hosted resource in Review Notes', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        'Those are also the only Universal Links.',
        '3. Meditation Studio — public — https://cabohealth.org/apps/meditation/\n\nThose are also the only Universal Links.',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Review Notes contain an unapproved hosted-resource URL/i);
    },
  );
});

test('metadata verifier rejects a third Review Notes resource even without a URL', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        'Those are also the only Universal Links.',
        '3. Meditation Studio — public\n\nThose are also the only Universal Links.',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Guideline 4\.7 resource list must contain exactly the two approved entries/i);
    },
  );
});

test('metadata verifier rejects credentials in versioned Review Notes', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, `${source}\nReviewer password: ExampleSecret123!\n`);
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Review Notes appear to contain a credential/i);
    },
  );
});

test('metadata verifier rejects excluded modules in Review Notes', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, `${source}\n3. Sleep Lab — public\n`);
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Review Notes name excluded release scope/i);
    },
  );
});

test('metadata verifier rejects an external release gate marked ready', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/release-manifest.json`, (manifest) => {
      manifest.gates.sellerLegalEntity = 'ready';
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /sellerLegalEntity must remain blocked-external/i);
    },
  );
});

test('metadata verifier reconciles authoritative Task 7 facts and current app config', async (t) => {
  const mutations = [
    ['changed legal sign-off', (root) => mutateJson(root, 'release/compliance-facts.json', (facts) => {
      facts.legalEntity.legalSignOffStatus = 'verified';
    }), /authoritative legal sign-off status no longer matches/i],
    ['current app already changed', (root) => mutateJson(root, 'app.json', (app) => {
      app.expo.version = '3.0';
      app.expo.ios.buildNumber = '4';
    }), /manifest says appJsonUpdated=false/i],
    ['third actual catalog slug', (root) => {
      const file = join(root, 'constants/publicMiniapps.ts');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        "['healthy-recipes', 'clinic-guide'] as const",
        "['healthy-recipes', 'clinic-guide', 'meditation'] as const",
      ));
    }, /authoritative catalog must contain exactly the two approved slugs/i],
  ];

  for (const [name, mutate, expected] of mutations) {
    await t.test(name, () => withReleaseFixture(
      mutate,
      (result) => {
        assert.equal(result.status, 1, result.stdout || result.stderr);
        assert.match(result.stderr, expected);
      },
    ));
  }
});

test('metadata verifier rejects an unconditional Data Not Collected recommendation', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/app-privacy.json`, (privacy) => {
      privacy.recommendedAppPrivacyAnswer = 'data-not-collected';
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /App Privacy recommendation must remain conditional/i);
    },
  );
});

test('metadata verifier rejects an age projection without all three required conditions', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/age-rating.json`, (age) => {
      age.conditions.unrestrictedWebAccess.requiredAnswer = true;
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /9\+ projection requires unrestrictedWebAccess=false/i);
    },
  );
});

test('metadata verifier rejects extra or contradictory age-rating answers', async (t) => {
  const mutations = [
    ['UGC changed to yes', (age) => { age.otherSupportedAnswers.userGeneratedContent = true; }],
    ['extra condition', (age) => { age.conditions.unexpected = { requiredAnswer: false }; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/age-rating.json`, mutate),
      (result) => {
        assert.equal(result.status, 1, result.stdout || result.stderr);
        assert.match(result.stderr, /age-rating condition and supported-answer schemas must be exact/i);
      },
    ));
  }
});

test('metadata verifier binds screenshot planning to the exact candidate build', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/screenshots-manifest.json`, (screenshots) => {
      screenshots.buildNumber = '5';
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /screenshot manifest must target 3\.0 build 4/i);
    },
  );
});

test('metadata verifier rejects public copy that presents the app as a generic marketplace', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'es-MX.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        /(?<=## Promotional Text\n)[^\n]+/,
        'Un marketplace para instalar muchas aplicaciones.',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /es-MX public metadata contains forbidden marketplace framing/i);
    },
  );
});

test('metadata verifier rejects an empty required localization field', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'en-US.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        /(?<=## Description\n)[\s\S]*?(?=\n## Keywords)/,
        '',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /en-US Description must not be empty/i);
    },
  );
});

test('metadata verifier counts Apple localization limits by characters, not UTF-8 bytes', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'es-MX.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        /(?<=## Keywords\n)[^\n]+/,
        `salud,${'é'.repeat(90)}`,
      ));
    },
    (result) => assert.equal(result.status, 0, result.stderr || result.stdout),
  );
});
