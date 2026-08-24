import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

function recordOwnerConfirmations() {
  // The canonical v3 fixture already contains the five verified owner facts.
}

function addOwnerSellerDraft() {
  // The canonical v3 fixture already contains the exact owner/seller draft.
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

test('metadata verifier rejects empty required release and authoritative artifacts', async (t) => {
  for (const relativePath of [
    `${releasePath}/review-notes.md`,
    `${releasePath}/en-US.md`,
    `${releasePath}/screenshots-manifest.json`,
    'release/compliance-facts.json',
    'release/public-contact-facts.json',
  ]) {
    await t.test(relativePath, () => withReleaseFixture(
      (root) => writeFileSync(join(root, relativePath), ''),
      (result) => {
        assert.equal(result.status, 1, `${relativePath} empty artifact bypassed verifier`);
        assert.match(result.stderr, /must not be empty/iu);
      },
    ));
  }
});

test('metadata verifier rejects null JSON authorities instead of skipping them', async (t) => {
  for (const relativePath of [
    `${releasePath}/release-manifest.json`,
    `${releasePath}/age-rating.json`,
    `${releasePath}/app-privacy.json`,
  ]) {
    await t.test(relativePath, () => withReleaseFixture(
      (root) => writeFileSync(join(root, relativePath), 'null\n'),
      (result) => {
        assert.equal(result.status, 1, `${relativePath} null authority bypassed verifier`);
        assert.match(result.stderr, /must be a JSON object/iu);
      },
    ));
  }
});

test('Review Notes use the owner-authorized hosting disclosure and current manual-entry behavior', () => {
  const notes = readFileSync(join(projectRoot, releasePath, 'review-notes.md'), 'utf8');

  assert.doesNotMatch(notes, /\[INSERT VERIFIED HOSTINGER REQUEST-LOG FIELDS/i);
  assert.doesNotMatch(notes, /continues automatically|about 1\.6 seconds/i);
  assert.doesNotMatch(notes, /\bOn Apps\b|\bReturn to Apps\b/i);
  assert.match(notes, /remains on the introduction until the reviewer taps “Enter CaboHealth”/i);
  assert.match(notes, /On Home, confirm two public resources and locked Client Resources/i);
  assert.match(notes, /IP address, timestamp, HTTP method, requested resource, device\/user-agent details, country, response bytes, and latency/i);
  assert.match(notes, /Hostinger logs IP address, browser\/user-agent, requested URL, and technical errors/i);
  assert.match(notes, /hPanel shows logs up to 7 days/i);
  assert.match(notes, /additional retention and deletion are controlled by Hostinger/i);
  assert.match(notes, /Launch nonces and hosted sessions are short-lived/i);
  assert.match(notes, /Home > Client Resources > “Delete review access and data”/i);
  assert.match(notes, /Confirm pending\/completed; if pending, reopen it without signing in to receive completion confirmation/i);
  assert.match(notes, /Durable deletion revokes access on acceptance; expiry\/admin revocation queues production cleanup/i);
  assert.match(notes, /random 256-bit receipt stays in SecureStore/i);
  assert.match(notes, /server keeps only a keyed-HMAC lookup and status timestamps/i);
  assert.match(notes, /expects completion within 30 days/i);
  assert.match(notes, /app confirms completion after reopening/i);
  assert.match(notes, /Staff audits are scheduled for deletion 30 days after creation; Firestore TTL deletion is asynchronous/i);
  assert.match(notes, /Cloud Functions rate-limits a transient source IP; it stores no raw IP, only a keyed-HMAC bucket with a 30-minute deadline/i);
});

test('metadata verifier rejects Review Notes regressions in hosting facts or entry behavior', async (t) => {
  const mutations = [
    [
      'hosting placeholder restored',
      (source) => source.replace(
        /Prior technical verification observed Hostinger[\s\S]*?no tracking\./u,
        '[INSERT VERIFIED HOSTINGER REQUEST-LOG FIELDS, PURPOSE, RETENTION, DELETION, AND FINAL APP PRIVACY MAPPING.]',
      ),
      /obsolete hosting blocker placeholder/i,
    ],
    [
      'observed log fields omitted',
      (source) => source.replace(
        /Prior technical verification observed Hostinger access-log fields: IP address, timestamp, HTTP method, requested resource, device\/user-agent details, country, response bytes, and latency\. /u,
        '',
      ),
      /missing observed Hostinger log fields/i,
    ],
    [
      'log fields generalized',
      (source) => source.replace(
        'Hostinger logs IP address, browser/user-agent, requested URL, and technical errors',
        'ordinary request data',
      ),
      /missing owner-authorized Hostinger log fields/i,
    ],
    [
      'hPanel duration changed',
      (source) => source.replace('hPanel shows logs up to 7 days', 'hPanel shows logs for 30 days'),
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
    [
      'launch and hosted-session lifecycle generalized',
      (source) => source.replace('Launch nonces and hosted sessions are short-lived.', 'Grants are short-lived.'),
      /missing short-lived launch and hosted-session disclosure/i,
    ],
    [
      'deletion lifecycle generalized',
      (source) => source.replace(
        'Durable deletion revokes access on acceptance; expiry/admin revocation queues production cleanup.',
        'Account removal is available.',
      ),
      /missing exact deletion lifecycle disclosure/i,
    ],
    [
      'review deletion path omitted',
      (source) => source.replace('Home > Client Resources > “Delete review access and data”', 'Settings > Delete'),
      /missing exact App Review deletion path/i,
    ],
    [
      'deletion status review step omitted',
      (source) => source.replace('Confirm pending/completed; if pending, reopen it without signing in to receive completion confirmation.', 'Close the app.'),
      /missing deletion status and completion-confirmation review step/i,
    ],
    [
      'deletion receipt downgraded',
      (source) => source.replace('A random 256-bit receipt stays in SecureStore', 'A deletion marker is stored locally'),
      /missing durable deletion receipt disclosure/i,
    ],
    [
      'deletion receipt server boundary omitted',
      (source) => source.replace('the server keeps only a keyed-HMAC lookup and status timestamps', 'the server stores the receipt'),
      /missing deletion receipt server-boundary disclosure/i,
    ],
    [
      'deletion completion window guaranteed',
      (source) => source.replace('expects completion within 30 days', 'guarantees completion within 30 days'),
      /missing non-guaranteed expected deletion window/i,
    ],
    [
      'deletion completion confirmation omitted',
      (source) => source.replace('the app confirms completion after reopening', 'completion is not shown'),
      /missing in-app deletion completion confirmation/i,
    ],
    [
      'audit deadline made synchronous',
      (source) => source.replace(
        'Staff audits are scheduled for deletion 30 days after creation; Firestore TTL deletion is asynchronous.',
        'Staff audits are retained for 30 days.',
      ),
      /missing asynchronous audit-deletion disclosure/i,
    ],
    [
      'Cloud Functions source-IP boundary omitted',
      (source) => source.replace(
        'Cloud Functions rate-limits a transient source IP; it stores no raw IP, only a keyed-HMAC bucket with a 30-minute deadline.',
        'Cloud Functions handles technical traffic.',
      ),
      /missing transient source-IP rate-limit disclosure/i,
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
    'saved public-resource slugs and order',
    'language, appearance, haptics, and effects preferences',
    'recipe favorite keys',
    'visit-checklist completion state',
  ]);
  assert.equal(privacy.schemaVersion, 4);
  assert.deepEqual(privacy.deletion, {
    durable: true,
    mechanism: 'transactional deletion tombstone plus idempotent retry worker',
    activeUserPath: 'Home > Client Resources > Delete access account and data',
    responseStatuses: ['pending', 'completed'],
    authorizationRevokedWhenAccepted: true,
    grantExpiryQueuesDeletion: true,
    administratorRevocationQueuesDeletion: true,
    retryWorkerMinutes: 5,
    completionTimeGuaranteed: false,
  });
  assert.deepEqual(privacy.deletionReceiptStatus, {
    receiptEntropyBits: 256,
    receiptEncoding: 'base64url',
    receiptEncodedLength: 43,
    nativeStorage: 'SecureStore',
    localStates: ['prepared', 'accepted'],
    preparedBeforeDeletionRequest: true,
    deleteRequestFields: ['installationId', 'deletionReceipt'],
    productionStatusCallable: 'getClientAccountDeletionStatus',
    reviewStatusCallable: 'getAppReviewAccountDeletionStatus',
    statusRequestFields: ['deletionReceipt'],
    statusResponse: {
      schemaVersion: 1,
      exactFields: [
        'schemaVersion',
        'status',
        'requestedAtMs',
        'expectedCompletionByMs',
        'completedAtMs',
      ],
      statuses: ['pending', 'completed'],
      pendingCompletedAtMs: null,
      timestampsAreIntegers: true,
    },
    limitedUseAppCheckRequired: true,
    firebaseAuthenticationRequired: false,
    rawReceiptStoredServerSide: false,
    serverLookupRepresentation: 'versioned keyed HMAC lookup only',
    productionCollection: '_private_account_deletion_receipts',
    reviewCollection: 'review_sandbox_account_deletion_receipts',
    separateRealmPeppers: true,
    statusRecordContainsUid: false,
    statusRecordContainsCode: false,
    statusRecordContainsResourceUrl: false,
    expectedCompletionDays: 30,
    expectedCompletionGuaranteed: false,
    retryWorkerMinutes: 5,
    pendingHasTtl: false,
    pendingRetention: 'until cleanup completes',
    completedRecordContainsOnlyStatusTimestamps: true,
    completedRetentionDays: 30,
    completedRetentionStartsAt: 'completedAtMs',
    completedPhysicalTtlDeletionAsynchronous: true,
    checksOnClientResourcesReopen: true,
    completionConfirmationInApp: true,
    localReceiptClearedAfterCompletedAcknowledgement: true,
    preparedNotFoundClearsReceipt: false,
    preparedNotFoundRestoresAccess: false,
    preparedNotFoundResubmitsSameReceipt: true,
    acceptedNotFoundRestoresAccess: false,
  });
  assert.deepEqual(privacy.reviewSandbox, {
    separateNamespace: true,
    multiDevice: true,
    fixedNonClientSample: true,
    productionClientRecordsExposed: false,
    userInitiatedDeletion: true,
    activeUserPath: 'Home > Client Resources > Delete review access and data',
    responseStatuses: ['pending', 'completed'],
    authorizationRevokedWhenAccepted: true,
    currentIdentityInactivityEligibilityDays: 30,
    staleGenerationEligibility: 'immediate',
    retryWorkerMinutes: 5,
    completionTimeGuaranteed: false,
    status: 'pending-activation-and-staging-e2e',
  });
  assert.deepEqual(privacy.cloudFunctionRequestSecurity, {
    rawSourceIpProcessedTransiently: true,
    rawSourceIpStored: false,
    storedRateLimitRepresentation: 'versioned keyed HMAC lookup only',
    purpose: ['rate limiting', 'abuse prevention'],
    rateLimitBucketDeletionDeadlineMinutes: 30,
    physicalTtlDeletionAsynchronous: true,
    tracking: false,
  });
  assert.deepEqual(privacy.accessArtifacts, {
    redemptionRequestDigestDeadlineMinutes: 5,
    launchNonceDeadlineSeconds: 60,
    webSessionMaximumMinutes: 60,
    brokerReplayDigestDeadlineMinutes: 2,
    deletionTombstoneHasTtl: false,
    deletionTombstoneRetention: 'until linked-data and Firebase Auth cleanup completes',
    containsPlaintextSecrets: false,
  });
  assert.deepEqual(privacy.applicationAudit, {
    purpose: 'security and operational accountability',
    deletionDeadlineDays: 30,
    physicalTtlDeletionAsynchronous: true,
    actorLabel: 'Staff',
    containsActorUid: false,
    containsCodes: false,
    containsResourceUrls: false,
    containsClientNames: false,
  });
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

test('metadata verifier keeps Staff Access review blocked without isolated credentials or Apple direction', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        /Staff Access is an owner\/operator surface; reviewer access, if required, is supplied separately in App Store Connect\.\n/u,
        'Staff Access is ready for App Review.\n',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Staff Access review-access disclosure/iu);
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
        'Only these Universal Links enter;',
        '4. Meditation Studio — public — https://cabohealth.org/apps/meditation/\n\nOnly these Universal Links enter;',
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
        'Only these Universal Links enter;',
        '4. Meditation Studio — public\n\nOnly these Universal Links enter;',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Guideline 4\.7 resource list must contain exactly two public entries and one protected Client Resources entry/i);
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

test('metadata verifier rejects canonical CH and AR credentials in Review Notes', async (t) => {
  for (const code of [
    'CH-01234567-89ABCDEF-01234567-89ABCDEF',
    'AR-01234567-89ABCDEF-01234567-89ABCDEF',
  ]) {
    await t.test(code.slice(0, 2), () => withReleaseFixture(
      (root) => {
        const file = join(root, releasePath, 'review-notes.md');
        writeFileSync(file, `${readFileSync(file, 'utf8')}\nApp Review credential: ${code}\n`);
      },
      (result) => {
        assert.equal(result.status, 1, `${code.slice(0, 2)} credential bypassed Review Notes scan`);
        assert.match(result.stderr, /appear to contain a credential/iu);
      },
    ));
  }
});

test('metadata verifier rejects credentials outside the paste-ready body, with spaced groups, or in another release checklist', async (t) => {
  const mutations = [
    ['before marker', 'review-notes.md', (source) => source.replace(
      '## Paste-ready body after all gates are resolved',
      'App Review credential: AR-01234567-89ABCDEF-01234567-89ABCDEF\n\n## Paste-ready body after all gates are resolved',
    )],
    ['spaced groups', 'review-notes.md', (source) => `${source}\nAR-0123 4567-89AB CDEF-0123 4567-89AB CDEF\n`],
    ['other checklist', 'submission-gates.md', (source) => `${source}\nCH-01234567-89ABCDEF-01234567-89ABCDEF\n`],
  ];
  for (const [name, relativePath, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => {
        const file = join(root, releasePath, relativePath);
        writeFileSync(file, mutate(readFileSync(file, 'utf8')));
      },
      (result) => {
        assert.equal(result.status, 1, `${name} credential bypassed repository scan`);
        assert.match(result.stderr, /credential|CH or AR/iu);
      },
    ));
  }
});

test('metadata verifier rejects access credentials in project-level release authorities', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, 'release/data-inventory.md');
      writeFileSync(
        file,
        `${readFileSync(file, 'utf8')}\nApp Review credential: AR-01234567-89ABCDEF-01234567-89ABCDEF\n`,
      );
    },
    (result) => {
      assert.equal(result.status, 1, `project-level release credential bypassed scan:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /release\/data-inventory\.md.*CH or AR credential/iu);
    },
  );
});

test('metadata verifier never follows symbolic links in release authorities', () => {
  withReleaseFixture(
    (root) => {
      const path = join(root, 'release/data-inventory.md');
      rmSync(path);
      symlinkSync('content-rights.md', path);
    },
    (result) => {
      assert.equal(result.status, 1, `release authority symlink bypassed no-follow scan:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /must not be a symbolic link: release\/data-inventory\.md/iu);
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

test('metadata verifier rejects Review Notes that contradict the complimentary no-sale model', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace(
          'ACCESS, BUSINESS MODEL, AND DATA',
          'Clinic access costs USD 99.\n\nACCESS, BUSINESS MODEL, AND DATA',
        ),
      );
    },
    (result) => {
      assert.equal(result.status, 1, `paid-access contradiction bypassed Review Notes verifier:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /Review Notes contradict.*complimentary no-sale model/iu);
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

test('metadata verifier permits only the exact grounded completed evidence checkboxes', async (t) => {
  await t.test('the completed owner E2E gate cannot be reverted to pending', () => withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'submission-gates.md');
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace(
          '- [x] Run a controlled production end-to-end check',
          '- [ ] Run a controlled production end-to-end check',
        ),
      );
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /must retain the exact completed owner Staff Access E2E checkbox/iu);
    },
  ));

  const completedPublicWebGatePrefixes = [
    ['hosted legal', '- [x] Promote and origin-verify the independently reviewed and repinned Privacy, Terms, Support, and Report Content bytes'],
    ['AASA origin and CDN', '- [x] Deploy the ordered AASA authority with four launch/API exclusions followed by the three exact allowed roots'],
    ['public payload', '- [x] Verify the public two-miniapp/legal payload remains exact and no WordPress/unrelated files change.'],
  ];
  for (const [name, prefix] of completedPublicWebGatePrefixes) {
    await t.test(`the completed ${name} gate cannot be reverted to pending`, () => withReleaseFixture(
      (root) => {
        const file = join(root, releasePath, 'submission-gates.md');
        const source = readFileSync(file, 'utf8');
        const mutated = source.replace(prefix, prefix.replace('- [x]', '- [ ]'));
        assert.notEqual(mutated, source, `${name} fixture must contain its exact completed gate`);
        writeFileSync(file, mutated);
      },
      (result) => {
        assert.equal(result.status, 1, result.stdout || result.stderr);
        assert.match(result.stderr, /must retain every exact completed public web evidence checkbox/iu);
      },
    ));
  }

  await t.test('an unrelated completed gate remains rejected', () => withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'submission-gates.md');
      const source = readFileSync(file, 'utf8');
      const mutated = source.replace(/^- \[ \] /mu, '- [x] ');
      assert.notEqual(mutated, source, 'submission-gates fixture must contain an unrelated pending checkbox');
      writeFileSync(
        file,
        mutated,
      );
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /unsupported completed evidence checkbox/iu);
    },
  ));
});

test('metadata verifier rejects owner, category, territory, platform, rights, and external-gate drift', async (t) => {
  const mutations = [
    ['separate legal entity', (manifest) => { manifest.ownerSeller.brandIsSeparateLegalEntity = true; }, /brand must not be represented as a separate legal entity/i],
    ['registered organization', (manifest) => { manifest.ownerSeller.registeredOrganization = true; }, /seller must remain an individual/i],
    ['seller mismatch', (manifest) => { manifest.ownerSeller.legalSeller = 'Another Seller'; }, /legal seller must remain Ivan Guaderrama/i],
    ['owner territory drift', (manifest) => { manifest.ownerSeller.releaseTerritories = ['FRA']; }, /owner release territories must be exactly MEX and USA/i],
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
    ['privacy gate completed', (manifest) => { manifest.appStoreDraft.unresolvedExternalGates.finalPrivacyDisclosure = 'complete'; }, /finalPrivacyDisclosure must remain pending-final-linkage-category-review-and-save/i],
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
      'CaboHealth brings science-grounded general-wellness resources into one calm, bilingual experience.',
      'Cabo Health is a company.\n\nCaboHealth brings science-grounded general-wellness resources into one calm, bilingual experience.',
    )],
    ['App Privacy draft', 'app-privacy.md', (source) => `${source}\nCabo Health has been registered as an organization.\n`],
    ['es-MX public metadata', 'es-MX.md', (source) => `${source}\nCabo Health es una empresa y organización legal registrada.\n`],
    ['es-MX public metadata', 'es-MX.md', (source) => `${source}\nCabo Health es una compañía registrada.\n`],
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
      writeFileSync(file, source.replace(
        '## Paste-ready body after all gates are resolved',
        'Apple is a third-party organization.\n\n## Paste-ready body after all gates are resolved',
      ));
    },
    (result) => assert.equal(result.status, 0, result.stderr || result.stdout),
  );
});

test('metadata verifier rejects a data inventory that claims the audit stores actor UID', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, 'release/data-inventory.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        'fixed `actorLabel: Staff`, target suffix or opaque ID',
        'actor UID, target type or opaque ID',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /fixed Staff actor label without an actor UID/iu);
    },
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

test('metadata verifier rejects Data Not Collected for the retained v3 architecture', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/app-privacy.json`, (privacy) => {
      privacy.recommendedAppPrivacyAnswer = 'No, we do not collect data from this app';
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /App Privacy collection answer must remain Yes, we collect data from this app/i);
    },
  );
});

test('metadata verifier rejects App Privacy prose that drifts from its JSON authority', () => {
  withReleaseFixture(
    (root) => {
      writeFileSync(
        join(root, releasePath, 'app-privacy.md'),
        '# App Privacy\n\nData Not Collected. Saved in App Store Connect.\n',
      );
    },
    (result) => {
      assert.equal(result.status, 1, `contradictory App Privacy prose bypassed verifier:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /app-privacy\.md.*exact reviewed prose/iu);
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
    ['extra Cloud Functions request-security key', (privacy) => {
      privacy.cloudFunctionRequestSecurity.unexpected = true;
    }],
    ['extra access-artifact key', (privacy) => {
      privacy.accessArtifacts.unexpected = true;
    }],
    ['extra deletion key', (privacy) => {
      privacy.deletion.unexpected = true;
    }],
    ['extra deletion-receipt key', (privacy) => {
      privacy.deletionReceiptStatus.unexpected = true;
    }],
    ['extra deletion-status-response key', (privacy) => {
      privacy.deletionReceiptStatus.statusResponse.unexpected = true;
    }],
    ['extra audit key', (privacy) => {
      privacy.applicationAudit.unexpected = true;
    }],
    ['extra review-sandbox key', (privacy) => {
      privacy.reviewSandbox.unexpected = true;
    }],
    ['extra conditional-recommendation key', (privacy) => {
      privacy.conditionalRecommendation.unexpected = true;
    }],
    ['extra root key', (privacy) => {
      privacy.unexpected = true;
    }],
    ['audit exposes resource URLs', (privacy) => {
      privacy.applicationAudit.containsResourceUrls = true;
    }],
    ['audit purpose drift', (privacy) => {
      privacy.applicationAudit.purpose = 'analytics';
    }],
    ['audit deadline drift', (privacy) => {
      privacy.applicationAudit.deletionDeadlineDays = 31;
    }],
    ['audit physical TTL promise', (privacy) => {
      privacy.applicationAudit.physicalTtlDeletionAsynchronous = false;
    }],
    ['advertising provisional purpose', (privacy) => {
      privacy.conditionalRecommendation.provisionalPurpose = ['Targeted Advertising'];
    }],
    ['non-Apple fraud purpose taxonomy', (privacy) => {
      privacy.conditionalRecommendation.provisionalPurpose = [
        'App Functionality',
        'Fraud Prevention, Security, and Compliance',
      ];
    }],
    ['coarse location omitted', (privacy) => {
      privacy.conditionalRecommendation.provisionalCategoryMapping =
        privacy.conditionalRecommendation.provisionalCategoryMapping
          .filter((entry) => !entry.startsWith('Coarse Location'));
    }],
    ['group label instead of selectable data type', (privacy) => {
      privacy.conditionalRecommendation.provisionalCategoryMapping[0] = 'Identifiers';
    }],
    ['native resource URL', (privacy) => {
      privacy.backend.resourceUrlsReturnedToNative = true;
    }],
    ['debug App Check provider', (privacy) => {
      privacy.appCheck.providers = ['debug'];
    }],
    ['best-effort deletion', (privacy) => {
      privacy.deletion.mechanism = 'best effort';
    }],
    ['production deletion path drift', (privacy) => {
      privacy.deletion.activeUserPath = 'Settings';
    }],
    ['production deletion response drift', (privacy) => {
      privacy.deletion.responseStatuses = ['completed'];
    }],
    ['production expiry does not enqueue', (privacy) => {
      privacy.deletion.grantExpiryQueuesDeletion = false;
    }],
    ['production administrator revocation does not enqueue', (privacy) => {
      privacy.deletion.administratorRevocationQueuesDeletion = false;
    }],
    ['production retry interval drift', (privacy) => {
      privacy.deletion.retryWorkerMinutes = 10;
    }],
    ['deletion receipt entropy drift', (privacy) => {
      privacy.deletionReceiptStatus.receiptEntropyBits = 128;
    }],
    ['deletion receipt encoding drift', (privacy) => {
      privacy.deletionReceiptStatus.receiptEncoding = 'hex';
    }],
    ['deletion receipt storage drift', (privacy) => {
      privacy.deletionReceiptStatus.nativeStorage = 'AsyncStorage';
    }],
    ['deletion receipt prepared timing drift', (privacy) => {
      privacy.deletionReceiptStatus.preparedBeforeDeletionRequest = false;
    }],
    ['deletion receipt delete payload drift', (privacy) => {
      privacy.deletionReceiptStatus.deleteRequestFields = ['deletionReceipt'];
    }],
    ['deletion receipt status payload drift', (privacy) => {
      privacy.deletionReceiptStatus.statusRequestFields = ['uid'];
    }],
    ['deletion receipt response drift', (privacy) => {
      privacy.deletionReceiptStatus.statusResponse.statuses = ['completed'];
    }],
    ['deletion receipt App Check disabled', (privacy) => {
      privacy.deletionReceiptStatus.limitedUseAppCheckRequired = false;
    }],
    ['deletion receipt requires deleted Auth session', (privacy) => {
      privacy.deletionReceiptStatus.firebaseAuthenticationRequired = true;
    }],
    ['raw deletion receipt stored', (privacy) => {
      privacy.deletionReceiptStatus.rawReceiptStoredServerSide = true;
    }],
    ['deletion receipt lookup unkeyed', (privacy) => {
      privacy.deletionReceiptStatus.serverLookupRepresentation = 'plain SHA-256';
    }],
    ['deletion receipt realm collections merged', (privacy) => {
      privacy.deletionReceiptStatus.reviewCollection = privacy.deletionReceiptStatus.productionCollection;
    }],
    ['deletion receipt realm peppers merged', (privacy) => {
      privacy.deletionReceiptStatus.separateRealmPeppers = false;
    }],
    ['deletion receipt status includes UID', (privacy) => {
      privacy.deletionReceiptStatus.statusRecordContainsUid = true;
    }],
    ['deletion expected-completion guarantee invented', (privacy) => {
      privacy.deletionReceiptStatus.expectedCompletionGuaranteed = true;
    }],
    ['pending deletion receipt TTL enabled', (privacy) => {
      privacy.deletionReceiptStatus.pendingHasTtl = true;
    }],
    ['completed deletion receipt retention drift', (privacy) => {
      privacy.deletionReceiptStatus.completedRetentionDays = 31;
    }],
    ['completed deletion receipt TTL promise', (privacy) => {
      privacy.deletionReceiptStatus.completedPhysicalTtlDeletionAsynchronous = false;
    }],
    ['deletion receipt reopen check disabled', (privacy) => {
      privacy.deletionReceiptStatus.checksOnClientResourcesReopen = false;
    }],
    ['deletion completion confirmation disabled', (privacy) => {
      privacy.deletionReceiptStatus.completionConfirmationInApp = false;
    }],
    ['prepared missing receipt is cleared', (privacy) => {
      privacy.deletionReceiptStatus.preparedNotFoundClearsReceipt = true;
    }],
    ['prepared missing receipt restores access', (privacy) => {
      privacy.deletionReceiptStatus.preparedNotFoundRestoresAccess = true;
    }],
    ['prepared missing receipt changes on resubmission', (privacy) => {
      privacy.deletionReceiptStatus.preparedNotFoundResubmitsSameReceipt = false;
    }],
    ['accepted missing receipt restores access', (privacy) => {
      privacy.deletionReceiptStatus.acceptedNotFoundRestoresAccess = true;
    }],
    ['review self-deletion disabled', (privacy) => {
      privacy.reviewSandbox.userInitiatedDeletion = false;
    }],
    ['review deletion response drift', (privacy) => {
      privacy.reviewSandbox.responseStatuses = ['pending'];
    }],
    ['review inactivity eligibility drift', (privacy) => {
      privacy.reviewSandbox.currentIdentityInactivityEligibilityDays = 31;
    }],
    ['review stale-generation delay', (privacy) => {
      privacy.reviewSandbox.staleGenerationEligibility = 'after 30 days';
    }],
    ['review retry interval drift', (privacy) => {
      privacy.reviewSandbox.retryWorkerMinutes = 10;
    }],
    ['review completion guarantee', (privacy) => {
      privacy.reviewSandbox.completionTimeGuaranteed = true;
    }],
    ['raw source IP persisted', (privacy) => {
      privacy.cloudFunctionRequestSecurity.rawSourceIpStored = true;
    }],
    ['rate-limit representation drift', (privacy) => {
      privacy.cloudFunctionRequestSecurity.storedRateLimitRepresentation = 'raw IP address';
    }],
    ['rate-limit deadline drift', (privacy) => {
      privacy.cloudFunctionRequestSecurity.rateLimitBucketDeletionDeadlineMinutes = 31;
    }],
    ['rate-limit tracking enabled', (privacy) => {
      privacy.cloudFunctionRequestSecurity.tracking = true;
    }],
    ['redemption request deadline drift', (privacy) => {
      privacy.accessArtifacts.redemptionRequestDigestDeadlineMinutes = 6;
    }],
    ['launch nonce deadline drift', (privacy) => {
      privacy.accessArtifacts.launchNonceDeadlineSeconds = 61;
    }],
    ['web session maximum drift', (privacy) => {
      privacy.accessArtifacts.webSessionMaximumMinutes = 61;
    }],
    ['broker replay deadline drift', (privacy) => {
      privacy.accessArtifacts.brokerReplayDigestDeadlineMinutes = 3;
    }],
    ['tombstone TTL enabled', (privacy) => {
      privacy.accessArtifacts.deletionTombstoneHasTtl = true;
    }],
    ['plaintext access artifact', (privacy) => {
      privacy.accessArtifacts.containsPlaintextSecrets = true;
    }],
    ['saved client linkage', (privacy) => {
      privacy.clientAccount.status = 'saved';
    }],
    ['unkeyed code digest', (privacy) => {
      privacy.backend.codeDigests = 'plain SHA-256';
    }],
    ['missing backend providers', (privacy) => {
      privacy.backend.providers = [];
    }],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/app-privacy.json`, mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /App Privacy schemas and hosting purposes must be exact|App Privacy client-access architecture|conditional App Privacy mapping|exact privacy authority/iu);
      },
    ));
  }
});

test('metadata verifier rejects a projected 9+ rating without all three recorded questionnaire answers', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/age-rating.json`, (age) => {
      age.conditions.unrestrictedWebAccess.requiredAnswer = true;
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /projected 9\+ rating requires unrestrictedWebAccess=false/i);
    },
  );
});

test('metadata verifier rejects age-rating prose that drifts from its JSON authority', () => {
  withReleaseFixture(
    (root) => {
      writeFileSync(
        join(root, releasePath, 'age-rating.md'),
        '# Age rating\n\nFinal calculated rating: 17+. Advertising: Yes.\n',
      );
    },
    (result) => {
      assert.equal(result.status, 1, `contradictory age-rating prose bypassed verifier:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /age-rating\.md.*exact reviewed prose/iu);
    },
  );
});

test('metadata verifier requires the exact projected rating and pending recalculation state', async (t) => {
  const mutations = [
    ['previous saved rating removed', (age) => { age.previousSavedRating = null; }],
    ['calculated rating filled before ASC save', (age) => { age.calculatedRating = '9+'; }],
    ['draft status restored', (age) => { age.status = 'draft-conditional'; }],
    ['owner confirmation falsely closed', (age) => { age.ownerConfirmationRequired = false; }],
    ['App Store calculation falsely closed', (age) => { age.appStoreCalculationRequired = false; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/age-rating.json`, mutate),
      (result) => {
        assert.equal(result.status, 1, result.stdout || result.stderr);
        assert.match(result.stderr, /Age rating must remain projected 9\+ with owner reconfirmation and App Store recalculation required/i);
      },
    ));
  }
});

test('metadata verifier rejects extra or contradictory age-rating answers', async (t) => {
  const mutations = [
    ['UGC changed to yes', (age) => { age.otherSupportedAnswers.userGeneratedContent = true; }],
    ['medical information changed', (age) => { age.conditions.medicalOrTreatmentInformation.requiredAnswer = 'INFREQUENT'; }],
    ['health topics changed from presence value', (age) => { age.conditions.healthOrWellnessTopics.requiredAnswer = 'FREQUENT'; }],
    ['violence changed', (age) => { age.otherSupportedAnswers.violenceRealistic = 'INFREQUENT'; }],
    ['questionnaire scale changed', (age) => { age.questionnaireReference.frequencyScale = ['NONE', 'FREQUENT']; }],
    ['kids band enabled', (age) => { age.ageCategoryAndOverride.kidsAgeBand = 'FIVE_AND_UNDER'; }],
    ['extra condition', (age) => { age.conditions.unexpected = { requiredAnswer: false }; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/age-rating.json`, mutate),
      (result) => {
        assert.equal(result.status, 1, result.stdout || result.stderr);
        assert.match(
          result.stderr,
          /age-rating condition and supported-answer schemas must be exact|exact age-rating authority|Age rating must remain|requires (?:medicalOrTreatmentInformation|healthOrWellnessTopics)/i,
        );
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

test('metadata verifier rejects screenshot schema and evidence-authority drift', async (t) => {
  const mutations = [
    ['schema', (screenshots) => { screenshots.schemaVersion = 999; }],
    ['evidence keys', (screenshots) => { screenshots.requiredEvidence = {}; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/screenshots-manifest.json`, mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} screenshot drift bypassed verifier`);
        assert.match(result.stderr, /Screenshot manifest must retain the exact authority schema/iu);
      },
    ));
  }
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
