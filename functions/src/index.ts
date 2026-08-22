import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString, type SecretParam } from 'firebase-functions/params';
import {
  HttpsError,
  onCall,
  onRequest,
  type CallableRequest,
} from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import {
  AccessCodeInputError,
  AccessCodeIssuer,
  AccessCodeLimitError,
} from './domain/accessCodeIssuer.js';
import {
  ClientAccessPublicError,
  ClientAccessRedeemer,
} from './domain/clientAccessRedeemer.js';
import { AdminClientAccessRevocationService } from './domain/adminClientAccessRevocation.js';
import { ClientAccessRemovalService } from './domain/clientAccessRemoval.js';
import {
  ClientAccountDeletionMaintenanceService,
  ClientAccountDeletionService,
} from './domain/clientAccountDeletion.js';
import { dispatchBrokerCommand } from './domain/brokerApi.js';
import { ClientSessionManager } from './domain/clientSessionManager.js';
import { ClientLaunchService } from './domain/clientLaunchService.js';
import { WebSessionBroker } from './domain/webSessionBroker.js';
import {
  AppReviewAccessRedeemer,
  AppReviewCredentialConflictError,
  AppReviewCredentialService,
  AppReviewInputError,
  AppReviewLaunchService,
  AppReviewSessionManager,
} from './domain/appReviewAccess.js';
import { AppReviewAccountDeletionService } from './domain/appReviewAccountDeletion.js';
import {
  AccountDeletionReceiptError,
  AccountDeletionReceiptStatusService,
} from './domain/accountDeletionReceipt.js';
import { AppReviewDataRetentionService } from './domain/appReviewDataRetention.js';
import {
  CatalogDraftAdminService,
  CatalogDraftConflictError,
  CatalogDraftInputError,
  CatalogDraftNotFoundError,
  type CatalogDraftInput,
  validateCatalogDraftInput,
} from './domain/catalogDraftAdmin.js';
import { AdminFirestoreDocumentDatabase } from './infrastructure/adminFirestoreDocumentDatabase.js';
import { FirestoreClientAccessStore } from './repositories/firestoreClientAccessStore.js';
import { FirestoreCatalogDraftStore } from './repositories/firestoreCatalogDraftStore.js';
import { FirestoreAppReviewSandboxStore } from './repositories/firestoreAppReviewSandboxStore.js';
import { parsePepperRingSecret, VersionedHmac } from './security/versionedHmac.js';
import {
  authorizeProductionAdmin,
  authorizeProductionStaff,
  type ProductionAdminPermission,
} from './security/adminAuthorization.js';
import {
  authenticateAppReviewBrokerRequest,
  authenticateBrokerRequest,
  signAppReviewBrokerResponse,
  signBrokerResponse,
} from './security/brokerAuthentication.js';
import { authorizeAppCheckSurface } from './security/appCheckAuthorization.js';

const REGION = 'us-central1';
const CODE_PEPPER_RING = defineSecret('CLIENT_CODE_PEPPER_RING');
const INSTALLATION_PEPPER_RING = defineSecret('CLIENT_INSTALLATION_PEPPER_RING');
const CLIENT_DELETION_RECEIPT_PEPPER_RING = defineSecret('CLIENT_DELETION_RECEIPT_PEPPER_RING');
const RATE_LIMIT_PEPPER_RING = defineSecret('CLIENT_RATE_LIMIT_PEPPER_RING');
const LAUNCH_NONCE_PEPPER_RING = defineSecret('CLIENT_LAUNCH_NONCE_PEPPER_RING');
const WEB_SESSION_PEPPER_RING = defineSecret('CLIENT_WEB_SESSION_PEPPER_RING');
const WEB_CSRF_PEPPER_RING = defineSecret('CLIENT_WEB_CSRF_PEPPER_RING');
const BROKER_HMAC_KEY_RING = defineSecret('CLIENT_BROKER_HMAC_KEY_RING');
const APP_REVIEW_CREDENTIAL_PEPPER_RING = defineSecret('APP_REVIEW_CREDENTIAL_PEPPER_RING');
const APP_REVIEW_INSTALLATION_PEPPER_RING = defineSecret('APP_REVIEW_INSTALLATION_PEPPER_RING');
const APP_REVIEW_DELETION_RECEIPT_PEPPER_RING = defineSecret('APP_REVIEW_DELETION_RECEIPT_PEPPER_RING');
const APP_REVIEW_RATE_LIMIT_PEPPER_RING = defineSecret('APP_REVIEW_RATE_LIMIT_PEPPER_RING');
const APP_REVIEW_LAUNCH_NONCE_PEPPER_RING = defineSecret('APP_REVIEW_LAUNCH_NONCE_PEPPER_RING');
const APP_REVIEW_WEB_SESSION_PEPPER_RING = defineSecret('APP_REVIEW_WEB_SESSION_PEPPER_RING');
const APP_REVIEW_WEB_CSRF_PEPPER_RING = defineSecret('APP_REVIEW_WEB_CSRF_PEPPER_RING');
const APP_REVIEW_BROKER_HMAC_KEY_RING = defineSecret('APP_REVIEW_BROKER_HMAC_KEY_RING');
const CLIENT_IOS_FIREBASE_APP_ID = defineString('CLIENT_IOS_FIREBASE_APP_ID');
const STAFF_WEB_FIREBASE_APP_ID = defineString('STAFF_WEB_FIREBASE_APP_ID');
const APP_REVIEW_FIRESTORE_DATABASE_ID = defineString('APP_REVIEW_FIRESTORE_DATABASE_ID');

if (getApps().length === 0) initializeApp();

const baseCallableOptions = {
  consumeAppCheckToken: true,
  enforceAppCheck: true,
  maxInstances: 10,
  memory: '256MiB' as const,
  region: REGION,
  timeoutSeconds: 30,
};

export const adminCreateClientAccessCode = onCall({
  ...baseCallableOptions,
  secrets: [CODE_PEPPER_RING],
}, async (request) => {
  assertStaffAppCheck(request);
  await assertProductionAdmin(request, 'client_codes');
  const input = parseIssueInput(request.data);
  const store = createStore();
  const issuer = new AccessCodeIssuer({
    codeHasher: hasherFromSecret(CODE_PEPPER_RING, 'cabohealth/access-code/v1'),
    store,
  });

  try {
    return await issuer.issue(input);
  } catch (error) {
    if (error instanceof AccessCodeInputError) {
      throw new HttpsError('invalid-argument', 'invalid_admin_input');
    }
    if (error instanceof AccessCodeLimitError) {
      throw new HttpsError('failed-precondition', 'active_code_limit');
    }
    throw new HttpsError('internal', 'client_access_operation_failed');
  }
});

export const adminGetStaffSession = onCall(baseCallableOptions, async (request) => {
  assertStaffAppCheck(request);
  if (!isRecord(request.data) || Object.keys(request.data).length !== 0) {
    throw new HttpsError('invalid-argument', 'invalid_admin_input');
  }
  try {
    const staff = await authorizeProductionStaff({
      auth: request.auth,
      loadAdmin: loadProductionAdmin,
      nowMs: Date.now(),
    });
    return Object.freeze({
      permissions: staff.permissions,
      scope: staff.scope,
    });
  } catch {
    throw new HttpsError('permission-denied', 'admin_authorization_failed');
  }
});

export const adminListClientAccessCodes = onCall(baseCallableOptions, async (request) => {
  assertStaffAppCheck(request);
  assertEmptyData(request.data, 'invalid_admin_input');
  await assertProductionAdmin(request, 'client_codes');
  try {
    return Object.freeze({ codes: await createStore().listAccessCodes(Date.now()) });
  } catch {
    throw new HttpsError('internal', 'client_access_operation_failed');
  }
});

export const adminRevokeClientAccessCode = onCall({
  ...baseCallableOptions,
  secrets: [INSTALLATION_PEPPER_RING, CLIENT_DELETION_RECEIPT_PEPPER_RING],
}, async (request) => {
  assertStaffAppCheck(request);
  await assertProductionAdmin(request, 'client_codes');
  const codeId = parseCodeId(request.data);
  try {
    const result = await createAdminRevocationService().revoke(codeId);
    if (result.kind !== 'revoked') {
      throw new HttpsError('not-found', 'access_code_not_active');
    }
    return Object.freeze({ revoked: true });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'client_access_operation_failed');
  }
});

export const adminListCatalogDrafts = onCall(baseCallableOptions, async (request) => {
  assertStaffAppCheck(request);
  assertEmptyData(request.data, 'invalid_admin_input');
  await assertProductionAdmin(request, 'client_resource_drafts');
  try {
    return Object.freeze({ drafts: await createCatalogDraftService().list() });
  } catch {
    throw new HttpsError('internal', 'catalog_draft_operation_failed');
  }
});

export const adminCreateCatalogDraft = onCall(baseCallableOptions, async (request) => {
  assertStaffAppCheck(request);
  await assertProductionAdmin(request, 'client_resource_drafts');
  try {
    const draft = await createCatalogDraftService().create(
      validateCatalogDraftInput(request.data),
    );
    return Object.freeze({ draft });
  } catch (error) {
    throw mapCatalogDraftError(error);
  }
});

export const adminUpdateCatalogDraft = onCall(baseCallableOptions, async (request) => {
  assertStaffAppCheck(request);
  await assertProductionAdmin(request, 'client_resource_drafts');
  try {
    const input = parseCatalogDraftUpdate(request.data);
    const draft = await createCatalogDraftService().update(
      input.draftId,
      input.revision,
      input.draft,
    );
    return Object.freeze({ draft });
  } catch (error) {
    throw mapCatalogDraftError(error);
  }
});

export const adminArchiveCatalogDraft = onCall(baseCallableOptions, async (request) => {
  assertStaffAppCheck(request);
  await assertProductionAdmin(request, 'client_resource_drafts');
  try {
    const input = parseCatalogDraftArchive(request.data);
    const draft = await createCatalogDraftService().archive(input.draftId, input.revision);
    return Object.freeze({ archived: true, draft });
  } catch (error) {
    throw mapCatalogDraftError(error);
  }
});

export const adminListAudit = onCall(baseCallableOptions, async (request) => {
  assertStaffAppCheck(request);
  assertEmptyData(request.data, 'invalid_admin_input');
  await assertProductionAdmin(request, 'client_resource_drafts');
  try {
    return Object.freeze({ events: await createCatalogDraftService().listAudit() });
  } catch {
    throw new HttpsError('internal', 'audit_operation_failed');
  }
});

export const adminGetAppReviewCredentialStatus = onCall(baseCallableOptions, async (request) => {
  assertStaffAppCheck(request);
  assertEmptyData(request.data, 'invalid_admin_input');
  await assertProductionAdmin(request, 'app_review_credential');
  try {
    return await createAppReviewStore().credentialStatus();
  } catch {
    throw new HttpsError('internal', 'app_review_operation_failed');
  }
});

export const adminRotateAppReviewCredential = onCall({
  ...baseCallableOptions,
  secrets: [APP_REVIEW_CREDENTIAL_PEPPER_RING],
}, async (request) => {
  assertStaffAppCheck(request);
  await assertProductionAdmin(request, 'app_review_credential');
  try {
    const result = await createAppReviewCredentialService().rotate(
      parseAppReviewRotation(request.data),
    );
    if (result.status.generation === null || result.status.rotatedAtMs === null) {
      throw new Error('invalid_app_review_status');
    }
    return Object.freeze({
      generation: result.status.generation,
      oneTimeCredential: result.oneTimeCredential,
      purpose: 'app_review' as const,
      rotatedAtMs: result.status.rotatedAtMs,
    });
  } catch (error) {
    if (error instanceof AppReviewCredentialConflictError) {
      throw new HttpsError('aborted', 'app_review_generation_conflict');
    }
    if (error instanceof AppReviewInputError) {
      throw new HttpsError('invalid-argument', 'invalid_admin_input');
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'app_review_operation_failed');
  }
});

export const redeemAppReviewCredential = onCall({
  ...baseCallableOptions,
  secrets: [
    APP_REVIEW_CREDENTIAL_PEPPER_RING,
    APP_REVIEW_INSTALLATION_PEPPER_RING,
    APP_REVIEW_RATE_LIMIT_PEPPER_RING,
  ],
}, async (request) => {
  assertClientAppCheck(request);
  const input = parseAppReviewRedeemInput(request);
  const redeemer = new AppReviewAccessRedeemer({
    credentialHasher: hasherFromSecret(
      APP_REVIEW_CREDENTIAL_PEPPER_RING,
      'cabohealth/app-review/credential/v1',
    ),
    installationHasher: hasherFromSecret(
      APP_REVIEW_INSTALLATION_PEPPER_RING,
      'cabohealth/app-review/installation/v1',
    ),
    rateLimitHasher: hasherFromSecret(
      APP_REVIEW_RATE_LIMIT_PEPPER_RING,
      'cabohealth/app-review/rate-limit/v1',
    ),
    store: createAppReviewStore(),
    tokenIssuer: {
      createCustomToken: (subjectUid, claims) => getAuth().createCustomToken(subjectUid, claims),
    },
  });
  try {
    return await redeemer.redeem(input);
  } catch (error) {
    throw mapAppReviewClientError(error);
  }
});

export const refreshAppReviewAccess = onCall({
  ...baseCallableOptions,
  secrets: [APP_REVIEW_INSTALLATION_PEPPER_RING],
}, async (request) => {
  assertClientAppCheck(request);
  const subjectUid = assertAppReviewAuth(request);
  try {
    const grant = await createAppReviewSessionManager().refresh({
      installationId: parseInstallationId(request.data),
      subjectUid,
    });
    return Object.freeze({ grant });
  } catch (error) {
    throw mapAppReviewClientError(error);
  }
});

export const createAppReviewLaunch = onCall({
  ...baseCallableOptions,
  secrets: [APP_REVIEW_INSTALLATION_PEPPER_RING, APP_REVIEW_LAUNCH_NONCE_PEPPER_RING],
}, async (request) => {
  assertClientAppCheck(request);
  const subjectUid = assertAppReviewAuth(request);
  try {
    return await createAppReviewLaunchService().create({
      installationId: parseInstallationId(request.data),
      subjectUid,
    });
  } catch (error) {
    throw mapAppReviewClientError(error);
  }
});

export const deleteAppReviewAccount = onCall({
  ...baseCallableOptions,
  secrets: [APP_REVIEW_INSTALLATION_PEPPER_RING, APP_REVIEW_DELETION_RECEIPT_PEPPER_RING],
}, async (request) => {
  assertClientAppCheck(request);
  const subjectUid = assertAppReviewDeletionAuth(request);
  const input = parseDeletionRequestInput(request.data);
  try {
    return await createAppReviewAccountDeletionService().request({
      ...input,
      subjectUid,
    });
  } catch (error) {
    throw mapAppReviewAccountDeletionError(error);
  }
});

export const getAppReviewAccountDeletionStatus = onCall({
  ...baseCallableOptions,
  secrets: [APP_REVIEW_DELETION_RECEIPT_PEPPER_RING],
}, async (request) => {
  assertClientAppCheck(request);
  try {
    return await new AccountDeletionReceiptStatusService({
      receiptHasher: hasherFromSecret(
        APP_REVIEW_DELETION_RECEIPT_PEPPER_RING,
        'cabohealth/app-review/deletion-receipt/v1',
      ),
      store: createAppReviewStore(),
    }).getStatus(parseDeletionStatusInput(request.data));
  } catch (error) {
    throw mapDeletionReceiptStatusError(error, 'app_review');
  }
});

export const redeemClientAccessCode = onCall({
  ...baseCallableOptions,
  secrets: [CODE_PEPPER_RING, INSTALLATION_PEPPER_RING, RATE_LIMIT_PEPPER_RING],
}, async (request) => {
  assertClientAppCheck(request);
  const input = parseRedeemInput(request);
  const redeemer = new ClientAccessRedeemer({
    codeHasher: hasherFromSecret(CODE_PEPPER_RING, 'cabohealth/access-code/v1'),
    installationHasher: hasherFromSecret(
      INSTALLATION_PEPPER_RING,
      'cabohealth/installation/v1',
    ),
    rateLimitHasher: hasherFromSecret(
      RATE_LIMIT_PEPPER_RING,
      'cabohealth/rate-limit/v1',
    ),
    store: createStore(),
    tokenIssuer: {
      createCustomToken: (subjectUid) => getAuth().createCustomToken(subjectUid),
    },
  });

  try {
    return await redeemer.redeem(input);
  } catch (error) {
    if (error instanceof ClientAccessPublicError) {
      if (error.code === 'rate_limited') {
        throw new HttpsError('resource-exhausted', 'rate_limited', {
          retryAfterSeconds: error.retryAfterSeconds,
        });
      }
      throw new HttpsError('permission-denied', 'invalid_access');
    }
    throw new HttpsError('internal', 'client_access_operation_failed');
  }
});

export const refreshClientAccess = onCall({
  ...baseCallableOptions,
  secrets: [INSTALLATION_PEPPER_RING],
}, async (request) => {
  assertClientAppCheck(request);
  const subjectUid = assertClientAuth(request);
  try {
    const grant = await createSessionManager().refresh({
      installationId: parseInstallationId(request.data),
      subjectUid,
    });
    return Object.freeze({ grant });
  } catch (error) {
    throw mapClientAccessError(error);
  }
});

export const removeClientAccess = onCall({
  ...baseCallableOptions,
  secrets: [INSTALLATION_PEPPER_RING, CLIENT_DELETION_RECEIPT_PEPPER_RING],
}, async (request) => {
  assertClientAppCheck(request);
  const subjectUid = assertClientAuth(request);
  try {
    return await createClientAccessRemovalService().remove({
      installationId: parseInstallationId(request.data),
      subjectUid,
    });
  } catch (error) {
    throw mapClientAccessError(error);
  }
});

export const deleteClientAccount = onCall({
  ...baseCallableOptions,
  secrets: [INSTALLATION_PEPPER_RING, CLIENT_DELETION_RECEIPT_PEPPER_RING],
}, async (request) => {
  assertClientAppCheck(request);
  const subjectUid = assertClientAuth(request);
  const input = parseDeletionRequestInput(request.data);
  try {
    return await createAccountDeletionService().request({
      ...input,
      subjectUid,
    });
  } catch (error) {
    throw mapClientAccessError(error);
  }
});

export const getClientAccountDeletionStatus = onCall({
  ...baseCallableOptions,
  secrets: [CLIENT_DELETION_RECEIPT_PEPPER_RING],
}, async (request) => {
  assertClientAppCheck(request);
  try {
    return await new AccountDeletionReceiptStatusService({
      receiptHasher: hasherFromSecret(
        CLIENT_DELETION_RECEIPT_PEPPER_RING,
        'cabohealth/deletion-receipt/v1',
      ),
      store: createStore(),
    }).getStatus(parseDeletionStatusInput(request.data));
  } catch (error) {
    throw mapDeletionReceiptStatusError(error, 'production');
  }
});

export const retryClientAccountDeletions = onSchedule({
  maxInstances: 1,
  memory: '256MiB',
  region: REGION,
  schedule: 'every 5 minutes',
  secrets: [INSTALLATION_PEPPER_RING, CLIENT_DELETION_RECEIPT_PEPPER_RING],
  timeoutSeconds: 120,
}, async () => {
  const store = createStore();
  await createAccountDeletionMaintenanceService(store).runScheduled();
});

export const cleanupAppReviewData = onSchedule({
  maxInstances: 1,
  memory: '256MiB',
  region: REGION,
  schedule: 'every 5 minutes',
  timeoutSeconds: 120,
}, async () => {
  await createAppReviewDataRetentionService().runScheduled();
});

export const createClientLaunch = onCall({
  ...baseCallableOptions,
  secrets: [INSTALLATION_PEPPER_RING, LAUNCH_NONCE_PEPPER_RING],
}, async (request) => {
  assertClientAppCheck(request);
  const subjectUid = assertClientAuth(request);
  const input = parseLaunchInput(request.data);
  try {
    return await createLaunchService().create({ ...input, subjectUid });
  } catch (error) {
    throw mapClientAccessError(error);
  }
});

/** Server-to-server API used only by the CaboHealth client-resources host. */
export const brokerApi = onRequest({
  cors: false,
  maxInstances: 10,
  memory: '256MiB',
  region: REGION,
  secrets: [
    BROKER_HMAC_KEY_RING,
    LAUNCH_NONCE_PEPPER_RING,
    WEB_CSRF_PEPPER_RING,
    WEB_SESSION_PEPPER_RING,
  ],
  timeoutSeconds: 15,
}, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.set('X-Content-Type-Options', 'nosniff');
  try {
    const rawBody = request.rawBody;
    const contentType = request.get('content-type') ?? '';
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
      throw new Error('broker_authentication_failed');
    }
    const keyId = requiredHeader(request.get('x-cabohealth-key-id'));
    const requestId = requiredHeader(request.get('x-cabohealth-request-id'));
    const keyRing = parsePepperRingSecret(BROKER_HMAC_KEY_RING.value());
    const authenticated = authenticateBrokerRequest({
      body: rawBody,
      keyId,
      method: request.method,
      nowMs: Date.now(),
      path: request.path,
      requestId,
      signature: requiredHeader(request.get('x-cabohealth-signature')),
      timestamp: requiredHeader(request.get('x-cabohealth-timestamp')),
    }, keyRing);
    const result = await dispatchBrokerCommand({
      path: request.path,
      rawBody,
      requestHash: authenticated.requestHash,
    }, createWebSessionBroker());
    const responseBody = Buffer.from(JSON.stringify(result), 'utf8');
    response.set('X-CaboHealth-Key-Id', keyId);
    response.set('X-CaboHealth-Request-Id', requestId);
    response.set('X-CaboHealth-Response-Signature', signBrokerResponse({
      body: responseBody,
      keyId,
      path: request.path,
      requestId,
      status: 200,
    }, keyRing));
    response.status(200).type('application/json').send(responseBody);
  } catch {
    response.status(403).json(Object.freeze({ error: 'invalid_access' }));
  }
});

/** Isolated server-to-server broker for the fixed, non-production App Review sample. */
export const appReviewBrokerApi = onRequest({
  cors: false,
  maxInstances: 5,
  memory: '256MiB',
  region: REGION,
  secrets: [
    APP_REVIEW_BROKER_HMAC_KEY_RING,
    APP_REVIEW_LAUNCH_NONCE_PEPPER_RING,
    APP_REVIEW_WEB_CSRF_PEPPER_RING,
    APP_REVIEW_WEB_SESSION_PEPPER_RING,
  ],
  timeoutSeconds: 15,
}, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.set('X-Content-Type-Options', 'nosniff');
  try {
    const rawBody = request.rawBody;
    const contentType = request.get('content-type') ?? '';
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
      throw new Error('broker_authentication_failed');
    }
    const keyId = requiredHeader(request.get('x-cabohealth-key-id'));
    const requestId = requiredHeader(request.get('x-cabohealth-request-id'));
    const keyRing = parsePepperRingSecret(APP_REVIEW_BROKER_HMAC_KEY_RING.value());
    const authenticated = authenticateAppReviewBrokerRequest({
      body: rawBody,
      keyId,
      method: request.method,
      nowMs: Date.now(),
      path: request.path,
      requestId,
      signature: requiredHeader(request.get('x-cabohealth-signature')),
      timestamp: requiredHeader(request.get('x-cabohealth-timestamp')),
    }, keyRing);
    const result = await dispatchBrokerCommand({
      path: request.path,
      rawBody,
      requestHash: authenticated.requestHash,
    }, createAppReviewWebSessionBroker());
    const responseBody = Buffer.from(JSON.stringify(result), 'utf8');
    response.set('X-CaboHealth-Key-Id', keyId);
    response.set('X-CaboHealth-Request-Id', requestId);
    response.set('X-CaboHealth-Response-Signature', signAppReviewBrokerResponse({
      body: responseBody,
      keyId,
      path: request.path,
      requestId,
      status: 200,
    }, keyRing));
    response.status(200).type('application/json').send(responseBody);
  } catch {
    response.status(403).json(Object.freeze({ error: 'invalid_access' }));
  }
});

function createStore(): FirestoreClientAccessStore {
  return new FirestoreClientAccessStore(
    new AdminFirestoreDocumentDatabase(getFirestore()),
  );
}

function createAppReviewStore(): FirestoreAppReviewSandboxStore {
  return new FirestoreAppReviewSandboxStore(
    new AdminFirestoreDocumentDatabase(getFirestore(requireAppReviewDatabaseId())),
  );
}

function createAppReviewDataRetentionService(
  store: FirestoreAppReviewSandboxStore = createAppReviewStore(),
): AppReviewDataRetentionService {
  return new AppReviewDataRetentionService({
    authAccounts: {
      async deleteUser(subjectUid) {
        try {
          await getAuth().deleteUser(subjectUid);
        } catch (error) {
          if (isRecord(error) && error.code === 'auth/user-not-found') return;
          throw error;
        }
      },
    },
    store,
  });
}

function createAppReviewAccountDeletionService(): AppReviewAccountDeletionService {
  const store = createAppReviewStore();
  return new AppReviewAccountDeletionService({
    installationHasher: hasherFromSecret(
      APP_REVIEW_INSTALLATION_PEPPER_RING,
      'cabohealth/app-review/installation/v1',
    ),
    receiptHasher: hasherFromSecret(
      APP_REVIEW_DELETION_RECEIPT_PEPPER_RING,
      'cabohealth/app-review/deletion-receipt/v1',
    ),
    retention: createAppReviewDataRetentionService(store),
    store,
  });
}

function createAppReviewCredentialService(): AppReviewCredentialService {
  return new AppReviewCredentialService({
    credentialHasher: hasherFromSecret(
      APP_REVIEW_CREDENTIAL_PEPPER_RING,
      'cabohealth/app-review/credential/v1',
    ),
    store: createAppReviewStore(),
  });
}

function createAppReviewSessionManager(): AppReviewSessionManager {
  return new AppReviewSessionManager({
    installationHasher: hasherFromSecret(
      APP_REVIEW_INSTALLATION_PEPPER_RING,
      'cabohealth/app-review/installation/v1',
    ),
    store: createAppReviewStore(),
  });
}

function createAppReviewLaunchService(): AppReviewLaunchService {
  return new AppReviewLaunchService({
    installationHasher: hasherFromSecret(
      APP_REVIEW_INSTALLATION_PEPPER_RING,
      'cabohealth/app-review/installation/v1',
    ),
    nonceHasher: hasherFromSecret(
      APP_REVIEW_LAUNCH_NONCE_PEPPER_RING,
      'cabohealth/app-review/launch-nonce/v1',
    ),
    store: createAppReviewStore(),
  });
}

function createAppReviewWebSessionBroker(): WebSessionBroker {
  return new WebSessionBroker({
    csrfHasher: hasherFromSecret(
      APP_REVIEW_WEB_CSRF_PEPPER_RING,
      'cabohealth/app-review/web-csrf/v1',
    ),
    nonceHasher: hasherFromSecret(
      APP_REVIEW_LAUNCH_NONCE_PEPPER_RING,
      'cabohealth/app-review/launch-nonce/v1',
    ),
    sessionHasher: hasherFromSecret(
      APP_REVIEW_WEB_SESSION_PEPPER_RING,
      'cabohealth/app-review/web-session/v1',
    ),
    store: createAppReviewStore(),
  });
}

function createCatalogDraftService(): CatalogDraftAdminService {
  return new CatalogDraftAdminService({
    store: new FirestoreCatalogDraftStore(
      new AdminFirestoreDocumentDatabase(getFirestore()),
    ),
  });
}

function createSessionManager(
  store: FirestoreClientAccessStore = createStore(),
): ClientSessionManager {
  return new ClientSessionManager({
    installationHasher: hasherFromSecret(
      INSTALLATION_PEPPER_RING,
      'cabohealth/installation/v1',
    ),
    store,
  });
}

function createAdminRevocationService(): AdminClientAccessRevocationService {
  const store = createStore();
  return new AdminClientAccessRevocationService({
    accountDeletion: createAccountDeletionService(store),
    store,
  });
}

function createClientAccessRemovalService(): ClientAccessRemovalService {
  const store = createStore();
  return new ClientAccessRemovalService({
    accountDeletion: createAccountDeletionService(store),
    sessions: createSessionManager(store),
  });
}

function createAccountDeletionService(
  store: FirestoreClientAccessStore = createStore(),
): ClientAccountDeletionService {
  return new ClientAccountDeletionService({
    authAccounts: {
      async deleteUser(subjectUid) {
        try {
          await getAuth().deleteUser(subjectUid);
        } catch (error) {
          if (isRecord(error) && error.code === 'auth/user-not-found') return;
          throw error;
        }
      },
    },
    installationHasher: hasherFromSecret(
      INSTALLATION_PEPPER_RING,
      'cabohealth/installation/v1',
    ),
    receiptHasher: hasherFromSecret(
      CLIENT_DELETION_RECEIPT_PEPPER_RING,
      'cabohealth/deletion-receipt/v1',
    ),
    store,
  });
}

function createAccountDeletionMaintenanceService(
  store: FirestoreClientAccessStore,
): ClientAccountDeletionMaintenanceService {
  return new ClientAccountDeletionMaintenanceService({
    deletions: createAccountDeletionService(store),
    reconciler: store,
  });
}

function createLaunchService(): ClientLaunchService {
  return new ClientLaunchService({
    installationHasher: hasherFromSecret(
      INSTALLATION_PEPPER_RING,
      'cabohealth/installation/v1',
    ),
    nonceHasher: hasherFromSecret(
      LAUNCH_NONCE_PEPPER_RING,
      'cabohealth/launch-nonce/v1',
    ),
    store: createStore(),
  });
}

function createWebSessionBroker(): WebSessionBroker {
  return new WebSessionBroker({
    csrfHasher: hasherFromSecret(
      WEB_CSRF_PEPPER_RING,
      'cabohealth/web-csrf/v1',
    ),
    nonceHasher: hasherFromSecret(
      LAUNCH_NONCE_PEPPER_RING,
      'cabohealth/launch-nonce/v1',
    ),
    sessionHasher: hasherFromSecret(
      WEB_SESSION_PEPPER_RING,
      'cabohealth/web-session/v1',
    ),
    store: createStore(),
  });
}

function hasherFromSecret(secret: SecretParam, namespace: string): VersionedHmac {
  return new VersionedHmac(parsePepperRingSecret(secret.value()), namespace);
}

function assertFreshAppCheck(
  request: CallableRequest<unknown>,
  expectedAppId: string,
  expectedPlatform: 'ios' | 'web',
): void {
  try {
    authorizeAppCheckSurface({ app: request.app, expectedAppId, expectedPlatform });
  } catch {
    throw new HttpsError('failed-precondition', 'fresh_app_attestation_required');
  }
}

function assertClientAppCheck(request: CallableRequest<unknown>): void {
  assertFreshAppCheck(request, CLIENT_IOS_FIREBASE_APP_ID.value(), 'ios');
}

function assertStaffAppCheck(request: CallableRequest<unknown>): void {
  assertFreshAppCheck(request, STAFF_WEB_FIREBASE_APP_ID.value(), 'web');
}

async function assertProductionAdmin(
  request: CallableRequest<unknown>,
  requiredPermission: ProductionAdminPermission,
): Promise<void> {
  try {
    await authorizeProductionAdmin({
      auth: request.auth,
      loadAdmin: loadProductionAdmin,
      nowMs: Date.now(),
      requiredPermission,
    });
  } catch {
    throw new HttpsError('permission-denied', 'admin_authorization_failed');
  }
}

async function loadProductionAdmin(uid: string): Promise<unknown | undefined> {
  const snapshot = await getFirestore().doc(`_private_admins/${uid}`).get();
  return snapshot.exists ? snapshot.data() : undefined;
}

function assertClientAuth(request: CallableRequest<unknown>): string {
  if (!request.auth || !/^client_[A-Za-z0-9_-]{32}$/u.test(request.auth.uid)) {
    throw new HttpsError('unauthenticated', 'client_authentication_required');
  }
  return request.auth.uid;
}

function assertAppReviewAuth(request: CallableRequest<unknown>): string {
  if (
    !request.auth
    || !/^review_[A-Za-z0-9_-]{32}$/u.test(request.auth.uid)
    || request.auth.token.authority !== 'app_review'
  ) throw new HttpsError('unauthenticated', 'app_review_authentication_required');
  return request.auth.uid;
}

function assertAppReviewDeletionAuth(request: CallableRequest<unknown>): string {
  try {
    return assertAppReviewAuth(request);
  } catch {
    throw new HttpsError('permission-denied', 'invalid_access');
  }
}

function requireAppReviewDatabaseId(): string {
  const databaseId = APP_REVIEW_FIRESTORE_DATABASE_ID.value();
  if (!/^cabohealth-review-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/u.test(databaseId)) {
    throw new Error('app_review_database_not_configured');
  }
  return databaseId;
}

function parseIssueInput(value: unknown): {
  expiresAtMs: number;
  resourceIds: readonly string[];
  slot: 1 | 2 | 3 | 4;
} {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['expiresAtMs', 'resourceIds', 'slot'])
    || typeof value.expiresAtMs !== 'number'
    || !Array.isArray(value.resourceIds)
    || value.resourceIds.some((resourceId) => typeof resourceId !== 'string')
    || ![1, 2, 3, 4].includes(value.slot as number)
  ) throw new HttpsError('invalid-argument', 'invalid_admin_input');
  return {
    expiresAtMs: value.expiresAtMs,
    resourceIds: value.resourceIds as string[],
    slot: value.slot as 1 | 2 | 3 | 4,
  };
}

function parseRedeemInput(request: CallableRequest<unknown>): {
  code: string;
  installationId: string;
  requestId: string;
  sourceAddress: string;
} {
  const value = request.data;
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['code', 'installationId', 'requestId'])
    || typeof value.code !== 'string'
    || typeof value.installationId !== 'string'
    || typeof value.requestId !== 'string'
  ) throw new HttpsError('invalid-argument', 'invalid_access');
  const sourceAddress = request.rawRequest.ip ?? request.rawRequest.socket.remoteAddress;
  if (typeof sourceAddress !== 'string') {
    throw new HttpsError('invalid-argument', 'invalid_access');
  }
  return {
    code: value.code,
    installationId: value.installationId,
    requestId: value.requestId,
    sourceAddress,
  };
}

function parseAppReviewRotation(value: unknown): Readonly<{
  expectedGeneration: number | null;
}> {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['expectedGeneration'])
    || !(value.expectedGeneration === null || typeof value.expectedGeneration === 'number')
  ) throw new HttpsError('invalid-argument', 'invalid_admin_input');
  return Object.freeze({ expectedGeneration: value.expectedGeneration });
}

function parseAppReviewRedeemInput(request: CallableRequest<unknown>): Readonly<{
  credential: string;
  installationId: string;
  requestId: string;
  sourceAddress: string;
}> {
  const value = request.data;
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['credential', 'installationId', 'requestId'])
    || typeof value.credential !== 'string'
    || typeof value.installationId !== 'string'
    || typeof value.requestId !== 'string'
  ) throw new HttpsError('invalid-argument', 'invalid_access');
  const sourceAddress = request.rawRequest.ip ?? request.rawRequest.socket.remoteAddress;
  if (typeof sourceAddress !== 'string') {
    throw new HttpsError('invalid-argument', 'invalid_access');
  }
  return Object.freeze({
    credential: value.credential,
    installationId: value.installationId,
    requestId: value.requestId,
    sourceAddress,
  });
}

function parseCodeId(value: unknown): string {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['codeId'])
    || typeof value.codeId !== 'string'
  ) {
    throw new HttpsError('invalid-argument', 'invalid_admin_input');
  }
  return value.codeId;
}

function parseCatalogDraftUpdate(value: unknown): Readonly<{
  draft: CatalogDraftInput;
  draftId: string;
  revision: number;
}> {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['access', 'draftId', 'icon', 'revision', 'summary', 'title', 'url'])
    || typeof value.draftId !== 'string'
    || typeof value.revision !== 'number'
  ) throw new HttpsError('invalid-argument', 'invalid_admin_input');
  return Object.freeze({
    draft: validateCatalogDraftInput({
      access: value.access,
      icon: value.icon,
      summary: value.summary,
      title: value.title,
      url: value.url,
    }),
    draftId: value.draftId,
    revision: value.revision,
  });
}

function parseCatalogDraftArchive(value: unknown): Readonly<{
  draftId: string;
  revision: number;
}> {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['draftId', 'revision'])
    || typeof value.draftId !== 'string'
    || typeof value.revision !== 'number'
  ) throw new HttpsError('invalid-argument', 'invalid_admin_input');
  return Object.freeze({ draftId: value.draftId, revision: value.revision });
}

function parseInstallationId(value: unknown): string {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['installationId'])
    || typeof value.installationId !== 'string'
  ) {
    throw new HttpsError('invalid-argument', 'invalid_access');
  }
  return value.installationId;
}

function parseDeletionRequestInput(value: unknown): Readonly<{
  deletionReceipt: string;
  installationId: string;
}> {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['deletionReceipt', 'installationId'])
    || typeof value.deletionReceipt !== 'string'
    || typeof value.installationId !== 'string'
  ) throw new HttpsError('invalid-argument', 'invalid_access');
  return Object.freeze({
    deletionReceipt: value.deletionReceipt,
    installationId: value.installationId,
  });
}

function parseDeletionStatusInput(value: unknown): Readonly<{
  deletionReceipt: string;
}> {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['deletionReceipt'])
    || typeof value.deletionReceipt !== 'string'
  ) throw new HttpsError('invalid-argument', 'invalid_access');
  return Object.freeze({ deletionReceipt: value.deletionReceipt });
}

function parseLaunchInput(value: unknown): { installationId: string; resourceId: string } {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['installationId', 'resourceId'])
    || typeof value.installationId !== 'string'
    || typeof value.resourceId !== 'string'
  ) throw new HttpsError('invalid-argument', 'invalid_access');
  return { installationId: value.installationId, resourceId: value.resourceId };
}

function mapClientAccessError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof ClientAccessPublicError) {
    return new HttpsError('permission-denied', 'invalid_access');
  }
  return new HttpsError('internal', 'client_access_operation_failed');
}

function mapCatalogDraftError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof CatalogDraftInputError) {
    return new HttpsError('invalid-argument', 'invalid_admin_input');
  }
  if (error instanceof CatalogDraftConflictError) {
    return new HttpsError('aborted', 'catalog_draft_revision_conflict');
  }
  if (error instanceof CatalogDraftNotFoundError) {
    return new HttpsError('not-found', 'catalog_draft_not_found');
  }
  return new HttpsError('internal', 'catalog_draft_operation_failed');
}

function mapAppReviewClientError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof AppReviewInputError) {
    if (error.code === 'rate_limited') {
      return new HttpsError('resource-exhausted', 'rate_limited', {
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    return new HttpsError('permission-denied', 'invalid_access');
  }
  return new HttpsError('internal', 'app_review_operation_failed');
}

function mapAppReviewAccountDeletionError(error: unknown): HttpsError {
  if (error instanceof AppReviewInputError || error instanceof HttpsError) {
    return new HttpsError('permission-denied', 'invalid_access');
  }
  return new HttpsError('internal', 'app_review_operation_failed');
}

function mapDeletionReceiptStatusError(
  error: unknown,
  realm: 'app_review' | 'production',
): HttpsError {
  if (error instanceof AccountDeletionReceiptError || error instanceof HttpsError) {
    return new HttpsError('not-found', 'invalid_access');
  }
  return new HttpsError(
    'internal',
    realm === 'app_review' ? 'app_review_operation_failed' : 'client_access_operation_failed',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredHeader(value: string | undefined): string {
  if (!value) throw new Error('broker_authentication_failed');
  return value;
}

function assertEmptyData(value: unknown, message: string): void {
  if (!isRecord(value) || Object.keys(value).length !== 0) {
    throw new HttpsError('invalid-argument', message);
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}
