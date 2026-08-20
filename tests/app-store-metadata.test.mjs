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

function recordOwnerConfirmations(root) {
  mutateJson(root, 'release/compliance-facts.json', (facts) => {
    facts.slice = 'task-7f-age-rating-saved';
    facts.legalEntity.legalSignOffStatus = 'approved';
    facts.hosting.logTypes = {
      value: ['IP address', 'browser or user-agent', 'requested URL', 'technical errors'],
      status: 'verified',
    };
    facts.hosting.retention = {
      value: {
        description: 'Owner authorized 2026-08-17: hPanel visibility is up to 7 days; any additional retention is controlled by Hostinger.',
      },
      status: 'verified',
    };
    facts.hosting.deletionProcess = {
      value: {
        description: 'Owner authorized 2026-08-17: deletion beyond hPanel visibility is controlled by Hostinger.',
      },
      status: 'verified',
    };
    facts.support.responseSla = {
      value: {
        description: 'Owner confirmed 2026-08-17: respond within 2 business days, Monday-Friday, 10:00 AM-4:00 PM.',
      },
      status: 'verified',
    };
    facts.contentRights = {
      value: {
        approved: true,
        scope: 'Owner confirmed 2026-08-17: ownership or authorization for the Cabo Health logo, domain, texts, recipes, and images used by public v1.',
      },
      status: 'verified',
    };
    facts.exportCompliance = {
      value: {
        approved: true,
        determination: 'Owner confirmed 2026-08-17: standard iOS platform encryption and HTTPS only; no proprietary or custom cryptography.',
      },
      status: 'verified',
    };
    facts.medicalDevice = {
      value: {
        isMedicalDevice: false,
        basis: 'Owner confirmed 2026-08-17: educational only; no diagnosis, treatment, or medical-device function.',
      },
      status: 'verified',
    };
  });

  mutateJson(root, `${releasePath}/release-manifest.json`, (manifest) => {
    manifest.appStoreDraft.contentRights.status = 'owner-confirmed-scoped-pending-third-party-inventory';
    Object.assign(manifest.appStoreDraft.unresolvedExternalGates, {
      regulatedMedicalDevice: 'owner-confirmed-pending-exact-rc-review',
      exportCompliance: 'owner-confirmed-pending-exact-rc-review',
      finalPrivacyDisclosure: 'owner-authorized-pending-linkage-and-exact-rc-review',
      hostingLogRetention: 'owner-authorized-disclosure',
      hostingLogDeletion: 'owner-authorized-disclosure',
      supportResponseSla: 'owner-confirmed',
      allContentRights: 'owner-confirmed-scoped-pending-third-party-inventory',
    });
    Object.assign(manifest.gates, {
      legalEntitySignOff: 'owner-approved',
      brandAuthorization: 'owner-confirmed-pending-signed-declaration',
      contentRights: 'owner-confirmed-scoped-pending-third-party-inventory',
      hostingLogTypes: 'owner-authorized-disclosure',
      hostingLogRetention: 'owner-authorized-disclosure',
      hostingLogDeletion: 'owner-authorized-disclosure',
      supportResponseSla: 'owner-confirmed',
      medicalDevice: 'owner-confirmed-pending-exact-rc-review',
      exportCompliance: 'owner-confirmed-pending-exact-rc-review',
    });
  });

  mutateJson(root, `${releasePath}/app-privacy.json`, (privacy) => {
    privacy.status = 'owner-authorized-pending-linkage-and-exact-rc-review';
    privacy.hostedTechnicalRequestLogs.retention = 'hPanel visibility up to 7 days; any additional retention is controlled by Hostinger.';
    privacy.hostedTechnicalRequestLogs.deletionProcess = 'Deletion beyond hPanel visibility is controlled by Hostinger.';
  });
}

function addOwnerSellerDraft(manifest) {
  manifest.ownerSeller = {
    sellerType: 'individual',
    legalSeller: 'Ivan Guaderrama',
    publicBrand: 'Cabo Health',
    brandIsSeparateLegalEntity: false,
    registeredOrganization: false,
    dunsApplicable: false,
    dunsNumber: null,
    relationship: 'trade brand owned and operated by Ivan Guaderrama',
  };
  manifest.reviewRisk = {
    level: 'medium',
    basis: 'general-wellness/editorial-only',
    appleApprovalGuaranteed: false,
    fallback: 'If Apple determines the app provides healthcare services, obtain written Apple direction or later migrate to a registered organization.',
  };
  manifest.appStoreDraft = {
    status: 'pending-save',
    categories: {
      primary: 'Health & Fitness',
      secondary: 'Food & Drink',
      legacyPrimary: 'Medical',
      legacyPrimaryAction: 'replace',
    },
    copyright: '2026 Ivan Guaderrama',
    availability: {
      territories: ['MEX', 'USA'],
      automaticFutureTerritories: false,
      macAppleSiliconAvailable: false,
      visionProAvailable: false,
      status: 'pending-save',
    },
    dsa: {
      scope: 'app-level',
      traderStatus: 'non-trader/outside-EU-scope',
      releaseTerritories: ['MEX', 'USA'],
      reassessBeforeAddingEuTerritory: true,
      globalAccountState: 'unchanged',
      status: 'pending-save',
    },
    contentRights: {
      recommendedAnswer: 'Yes',
      usesThirdPartyMaterial: true,
      status: 'owner-confirmed-scoped-pending-third-party-inventory',
    },
    unresolvedExternalGates: {
      regulatedMedicalDevice: 'owner-confirmed-pending-exact-rc-review',
      exportCompliance: 'owner-confirmed-pending-exact-rc-review',
      finalPrivacyDisclosure: 'owner-authorized-pending-linkage-and-exact-rc-review',
      hostingLogRetention: 'owner-authorized-disclosure',
      hostingLogDeletion: 'owner-authorized-disclosure',
      supportResponseSla: 'owner-confirmed',
      ageRating: 'saved-app-store-calculation-9-plus',
      allContentRights: 'owner-confirmed-scoped-pending-third-party-inventory',
      brandEvidenceAttachment: 'pending-signed-owner-declaration',
      exactReleaseCandidate: 'pending-build-and-qa',
      screenshots: 'pending-exact-rc-capture',
      appStoreConnectSave: 'pending-save',
    },
  };
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

test('Review Notes use the owner-authorized hosting disclosure and current manual-entry behavior', () => {
  const notes = readFileSync(join(projectRoot, releasePath, 'review-notes.md'), 'utf8');

  assert.doesNotMatch(notes, /\[INSERT VERIFIED HOSTINGER REQUEST-LOG FIELDS/i);
  assert.doesNotMatch(notes, /continues automatically|about 1\.6 seconds/i);
  assert.doesNotMatch(notes, /\bOn Apps\b|\bReturn to Apps\b/i);
  assert.match(notes, /remains on the introduction until the reviewer taps “Enter CaboHealth”/i);
  assert.match(notes, /On Home, confirm both/i);
  assert.match(notes, /IP address, timestamp, HTTP method, requested resource, device and user-agent details, country, response bytes, and latency/i);
  assert.match(notes, /IP address, browser or user-agent, requested URL, and technical errors/i);
  assert.match(notes, /visible in hPanel for up to 7 days/i);
  assert.match(notes, /additional retention and deletion are controlled by Hostinger/i);
});

test('metadata verifier rejects Review Notes regressions in hosting facts or entry behavior', async (t) => {
  const mutations = [
    [
      'hosting placeholder restored',
      (source) => source.replace(
        /Opening either resource causes Hostinger[\s\S]*?They are not used for tracking\./u,
        '[INSERT VERIFIED HOSTINGER REQUEST-LOG FIELDS, PURPOSE, RETENTION, DELETION, AND FINAL APP PRIVACY MAPPING.]',
      ),
      /obsolete hosting blocker placeholder/i,
    ],
    [
      'observed log fields omitted',
      (source) => source.replace(
        /Prior technical verification observed Hostinger access-log fields for IP address, timestamp, HTTP method, requested resource, device and user-agent details, country, response bytes, and latency\. /u,
        '',
      ),
      /missing observed Hostinger log fields/i,
    ],
    [
      'log fields generalized',
      (source) => source.replace(
        'IP address, browser or user-agent, requested URL, and technical errors',
        'ordinary request data',
      ),
      /missing owner-authorized Hostinger log fields/i,
    ],
    [
      'hPanel duration changed',
      (source) => source.replace('visible in hPanel for up to 7 days', 'visible in hPanel for 30 days'),
      /missing owner-authorized hPanel visibility/i,
    ],
    [
      'automatic entry restored',
      (source) => source.replace(
        'The app remains on the introduction until the reviewer taps “Enter CaboHealth”.',
        'The app continues automatically after about 1.6 seconds.',
      ),
      /obsolete automatic introduction timing/i,
    ],
  ];

  for (const [name, mutate, expectedError] of mutations) {
    await t.test(name, () => {
      withReleaseFixture(
        (root) => {
          const path = join(root, releasePath, 'review-notes.md');
          writeFileSync(path, mutate(readFileSync(path, 'utf8')));
        },
        (result) => {
          assert.equal(result.status, 1, result.stdout || result.stderr);
          assert.match(result.stderr, expectedError);
        },
      );
    });
  }
});

test('App Privacy preserves observed logs separately from the owner-authorized disclosure record', () => {
  const privacy = JSON.parse(readFileSync(join(projectRoot, releasePath, 'app-privacy.json'), 'utf8'));
  const compliance = JSON.parse(readFileSync(join(projectRoot, 'release/compliance-facts.json'), 'utf8'));

  assert.deepEqual(
    privacy.hostedTechnicalRequestLogs.ownerAuthorizedFields,
    compliance.hosting.logTypes.value,
  );
  assert.deepEqual(privacy.hostedTechnicalRequestLogs.observedFields, [
    'IP address',
    'timestamp',
    'HTTP method',
    'requested resource',
    'device and user-agent details',
    'country',
    'response bytes',
    'latency',
  ]);
  assert.deepEqual(privacy.nativeBehavior.localOnlyState, [
    'saved public-module slugs and order',
    'language, appearance, haptics, and effects preferences',
    'recipe favorite keys',
    'visit-checklist completion state',
  ]);
});

test('metadata verifier accepts the five owner confirmations without releasing unverified gates', () => {
  withReleaseFixture(
    recordOwnerConfirmations,
    (result) => {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /draft verified; submission remains blocked/i);
    },
  );
});

test('metadata verifier rejects regression of an owner-confirmed fact to pending', async (t) => {
  const mutations = [
    ['medical-device declaration', (root) => mutateJson(root, 'release/compliance-facts.json', (facts) => {
      facts.medicalDevice = { value: null, status: 'pending' };
    })],
    ['support SLA', (root) => mutateJson(root, `${releasePath}/release-manifest.json`, (manifest) => {
      manifest.gates.supportResponseSla = 'pending-owner';
    })],
    ['hosting retention disclosure', (root) => mutateJson(root, `${releasePath}/app-privacy.json`, (privacy) => {
      privacy.hostedTechnicalRequestLogs.retention = null;
    })],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => {
        recordOwnerConfirmations(root);
        mutate(root);
      },
      (result) => {
        assert.equal(result.status, 1, `${name} regression bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /owner-confirmed|owner-authorized|verified owner confirmation/i);
      },
    ));
  }
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
      assert.match(result.stderr, /sellerLegalEntity must remain owner-confirmed-individual/i);
    },
  );
});

test('metadata verifier rejects owner, category, territory, platform, rights, and external-gate drift', async (t) => {
  const mutations = [
    ['separate legal entity', (manifest) => { manifest.ownerSeller.brandIsSeparateLegalEntity = true; }, /brand must not be represented as a separate legal entity/i],
    ['registered organization', (manifest) => { manifest.ownerSeller.registeredOrganization = true; }, /seller must remain an individual/i],
    ['seller mismatch', (manifest) => { manifest.ownerSeller.legalSeller = 'Another Seller'; }, /legal seller must remain Ivan Guaderrama/i],
    ['Medical category retained', (manifest) => { manifest.appStoreDraft.categories.primary = 'Medical'; }, /categories must replace Medical with Health & Fitness and Food & Drink/i],
    ['extra territory', (manifest) => { manifest.appStoreDraft.availability.territories.push('CAN'); }, /territories must be exactly MEX and USA/i],
    ['DSA EU reassessment disabled', (manifest) => {
      manifest.appStoreDraft.dsa.reassessBeforeAddingEuTerritory = false;
    }, /DSA must require reassessment before adding any EU territory/i],
    ['DSA global account state changed', (manifest) => {
      manifest.appStoreDraft.dsa.globalAccountState = 'changed';
    }, /DSA draft must not change global account state/i],
    ['DSA release territories mismatch availability', (manifest) => {
      manifest.appStoreDraft.dsa.releaseTerritories = ['MEX'];
    }, /DSA release territories must be exactly MEX and USA/i],
    ['automatic future territories', (manifest) => { manifest.appStoreDraft.availability.automaticFutureTerritories = true; }, /automatic future territories must remain disabled/i],
    ['Mac Apple Silicon enabled', (manifest) => { manifest.appStoreDraft.availability.macAppleSiliconAvailable = true; }, /Mac Apple Silicon availability must remain off/i],
    ['Vision Pro enabled', (manifest) => { manifest.appStoreDraft.availability.visionProAvailable = true; }, /Vision Pro availability must remain off/i],
    ['legacy Content Rights No', (manifest) => {
      manifest.appStoreDraft.contentRights.recommendedAnswer = 'No';
      manifest.appStoreDraft.contentRights.usesThirdPartyMaterial = false;
    }, /Content Rights recommendation must remain Yes.*third-party material/i],
    ['ASC marked saved', (manifest) => { manifest.appStoreDraft.status = 'saved'; }, /App Store draft must remain pending-save/i],
    ['DSA marked saved', (manifest) => { manifest.appStoreDraft.dsa.status = 'saved'; }, /DSA status must remain pending-save/i],
    ['medical-device gate completed', (manifest) => { manifest.appStoreDraft.unresolvedExternalGates.regulatedMedicalDevice = 'complete'; }, /regulatedMedicalDevice must remain owner-confirmed-pending-exact-rc-review/i],
    ['privacy gate completed', (manifest) => { manifest.appStoreDraft.unresolvedExternalGates.finalPrivacyDisclosure = 'complete'; }, /finalPrivacyDisclosure must remain owner-authorized-pending-linkage-and-exact-rc-review/i],
    ['rights gate completed', (manifest) => { manifest.appStoreDraft.unresolvedExternalGates.allContentRights = 'complete'; }, /allContentRights must remain owner-confirmed-scoped-pending-third-party-inventory/i],
  ];

  for (const [name, mutate, expected] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/release-manifest.json`, (manifest) => {
        addOwnerSellerDraft(manifest);
        mutate(manifest);
      }),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, expected);
      },
    ));
  }
});

test('metadata verifier rejects Review Notes without the individual seller and trade-brand disclosure', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        'This app is submitted by Ivan Guaderrama, an individual Apple Developer Program member. Cabo Health is a trade brand owned and operated by Ivan Guaderrama and is not represented as a separate legal entity.',
        'Cabo Health submits this app as an organization.',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Review Notes missing the individual seller and trade-brand disclosure/i);
    },
  );
});

test('metadata verifier rejects contradictory Cabo Health entity claims while retaining the truthful disclosure', async (t) => {
  const mutations = [
    ['Review Notes', 'review-notes.md', (source) => `${source}\nCabo Health is a registered organization.\n`],
    ['brand rights draft', 'content-rights-and-brand.md', (source) => `${source}\nCabo Health operates as a company.\n`],
    ['declarations draft', 'declarations.md', (source) => `${source}\nCabo Health is a legal entity.\n`],
    ['submission gates', 'submission-gates.md', (source) => `${source}\nCabo Health, a separate company, submits this app.\n`],
    ['en-US public metadata', 'en-US.md', (source) => source.replace(
      'CaboHealth brings two carefully curated public wellness resources into one calm, bilingual experience.',
      'Cabo Health is a company.\n\nCaboHealth brings two carefully curated public wellness resources into one calm, bilingual experience.',
    )],
    ['App Privacy draft', 'app-privacy.md', (source) => `${source}\nCabo Health has been registered as an organization.\n`],
  ];

  for (const [label, relativePath, mutate] of mutations) {
    await t.test(label, () => withReleaseFixture(
      (root) => {
        const file = join(root, releasePath, relativePath);
        const source = readFileSync(file, 'utf8');
        writeFileSync(file, mutate(source));
      },
      (result) => {
        assert.equal(result.status, 1, `${label} contradiction bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(
          result.stderr,
          new RegExp(`${label} contradicts.*legal entity, company, or organization`, 'i'),
        );
      },
    ));
  }
});

test('metadata verifier permits ordinary Apple Developer Program and third-party organization references', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, `${source}\nApple is a third-party organization that operates the Apple Developer Program.\n`);
    },
    (result) => assert.equal(result.status, 0, result.stderr || result.stdout),
  );
});

test('metadata verifier rejects an ownership declaration that claims a registered Cabo Health organization', () => {
  withReleaseFixture(
    (root) => {
      writeFileSync(
        join(root, releasePath, 'unsigned-ownership-declaration.md'),
        '# Signed ownership declaration\n\nCabo Health is a registered organization and legal entity.\n',
      );
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /ownership declaration must remain unsigned|must not claim.*legal entity|registered organization/i);
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

test('metadata verifier rejects App Privacy fields outside the observed log record', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/app-privacy.json`, (privacy) => {
      privacy.hostedTechnicalRequestLogs.observedFields.push('request header');
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Hosting request-log facts must retain the owner-authorized/i);
    },
  );
});

test('metadata verifier rejects unapproved App Privacy purposes and schema keys', async (t) => {
  const mutations = [
    ['marketing purpose', (privacy) => {
      privacy.hostedTechnicalRequestLogs.purpose = ['page delivery', 'Targeted Advertising'];
    }],
    ['extra hosted-log key', (privacy) => {
      privacy.hostedTechnicalRequestLogs.unexpected = true;
    }],
    ['extra native-behavior key', (privacy) => {
      privacy.nativeBehavior.unexpected = true;
    }],
    ['extra conditional-recommendation key', (privacy) => {
      privacy.conditionalRecommendation.unexpected = true;
    }],
    ['extra root key', (privacy) => {
      privacy.unexpected = true;
    }],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/app-privacy.json`, mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /App Privacy schemas and hosting purposes must be exact/i);
      },
    ));
  }
});

test('metadata verifier rejects a saved 9+ rating without all three recorded questionnaire answers', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/age-rating.json`, (age) => {
      age.conditions.unrestrictedWebAccess.requiredAnswer = true;
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /saved 9\+ rating requires unrestrictedWebAccess=false/i);
    },
  );
});

test('metadata verifier requires the exact saved App Store calculation', async (t) => {
  const mutations = [
    ['calculated rating removed', (age) => { age.calculatedRating = null; }],
    ['calculated rating changed', (age) => { age.calculatedRating = '12+'; }],
    ['draft status restored', (age) => { age.status = 'draft-conditional'; }],
    ['owner confirmation reopened', (age) => { age.ownerConfirmationRequired = true; }],
    ['App Store calculation reopened', (age) => { age.appStoreCalculationRequired = true; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/age-rating.json`, mutate),
      (result) => {
        assert.equal(result.status, 1, result.stdout || result.stderr);
        assert.match(result.stderr, /Age rating must retain the saved App Store Connect 9\+ calculation/i);
      },
    ));
  }
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
