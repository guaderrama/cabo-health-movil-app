import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalAasaBytes } from './generate-aasa.mjs';
import { CONTENT_SECURITY_POLICY, MINIAPP_SECURITY_HEADERS } from './build-miniapps.mjs';
import { assertStaticWebPolicy } from './web-release-policy.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP_ID = 'DQ8PH2DZ3R.com.cabohealth.app';
const RELEASE_ID = /^web-v1-[a-f0-9]{64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const ROLLBACK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const LEGAL_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ORIGIN_PAYLOAD_PATHS = Object.freeze([
  '.well-known/apple-app-site-association',
  'app/privacy/index.html',
  'app/report-content/index.html',
  'app/support/index.html',
  'app/terms/index.html',
  'apps/.htaccess',
  'apps/clinic-guide/app.js',
  'apps/clinic-guide/index.html',
  'apps/healthy-recipes/app.js',
  'apps/healthy-recipes/index.html',
  'apps/shared/logo.png',
  'apps/shared/motion.js',
  'apps/shared/shell.js',
  'apps/shared/styles.css',
]);
const LEGAL_URLS = Object.freeze([
  'https://cabohealth.org/app/privacy/',
  'https://cabohealth.org/app/terms/',
  'https://cabohealth.org/app/support/',
  'https://cabohealth.org/app/report-content/',
]);
const PROMOTE_TARGETS = Object.freeze([
  'public_html/apps/.htaccess',
  'public_html/apps/shared',
  'public_html/app/privacy',
  'public_html/app/terms',
  'public_html/app/support',
  'public_html/app/report-content',
  'public_html/apps/healthy-recipes',
  'public_html/apps/clinic-guide',
  'public_html/.well-known/apple-app-site-association',
]);
const INPUT_POLICY = Object.freeze([
  Object.freeze(['miniapps/dist', 'task6b-miniapp']),
  Object.freeze(['web-hosting/cabohealth.org/app/privacy/index.html', 'task7-legal']),
  Object.freeze(['web-hosting/cabohealth.org/app/terms/index.html', 'task7-legal']),
  Object.freeze(['web-hosting/cabohealth.org/app/support/index.html', 'task7-legal']),
  Object.freeze(['web-hosting/cabohealth.org/app/report-content/index.html', 'task7-legal']),
  Object.freeze(['web-hosting/cabohealth.org/.well-known/apple-app-site-association', 'aasa']),
  Object.freeze(['miniapps/shared/security-headers.conf', 'apache-security']),
  Object.freeze(['web-hosting/cabohealth.org/apps/.htaccess', 'apache-security']),
]);
const ARTIFACT_KEYS = Object.freeze([
  'schemaVersion',
  'artifactKind',
  'releaseId',
  'inventorySha256',
  'appId',
  'entrySlugs',
  'legalSlugs',
  'promoteTargets',
  'inputs',
  'files',
]);

function assertExactKeys(value, keys, label) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))
  ) throw new Error(`${label}_SCHEMA_INVALID`);
}

function isCanonicalUtcTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && new Date(value).toISOString() === value;
}

function publicUrlPath(path) {
  return `/${path.replace(/index\.html$/u, '')}`;
}

function headerProfile(path) {
  if (path.startsWith('apps/')) return 'miniapp-security';
  if (path.startsWith('app/')) return 'legal-frame-blocked';
  return 'aasa';
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function expectedMediaType(path) {
  if (path.endsWith('apple-app-site-association')) return 'application/json';
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  return 'text/plain; charset=utf-8';
}

function expectedKind(path) {
  if (path === 'apps/.htaccess') return 'apache-security';
  if (path.startsWith('apps/')) return 'task6b-miniapp';
  if (path.startsWith('app/')) return 'task7-legal';
  return 'aasa';
}

export function validateArtifactAuthority(artifact, authority) {
  assertExactKeys(authority, ['reviewedReleaseId', 'reviewedArtifactSha256'], 'REVIEWED_ARTIFACT_AUTHORITY');
  if (
    typeof authority.reviewedReleaseId !== 'string'
    || !RELEASE_ID.test(authority.reviewedReleaseId)
    || typeof authority.reviewedArtifactSha256 !== 'string'
    || !SHA256.test(authority.reviewedArtifactSha256)
  ) throw new Error('REVIEWED_ARTIFACT_AUTHORITY_INVALID');
  assertExactKeys(artifact, ARTIFACT_KEYS, 'WEB_ARTIFACT');
  if (
    artifact.schemaVersion !== 1
    || artifact.artifactKind !== 'cabohealth-public-web-v1'
    || artifact.appId !== 'DQ8PH2DZ3R.com.cabohealth.app'
    || JSON.stringify(artifact.entrySlugs) !== JSON.stringify(['healthy-recipes', 'clinic-guide'])
    || JSON.stringify(artifact.legalSlugs) !== JSON.stringify(['privacy', 'terms', 'support', 'report-content'])
    || JSON.stringify(artifact.promoteTargets) !== JSON.stringify(PROMOTE_TARGETS)
    || !Array.isArray(artifact.inputs)
    || artifact.inputs.length !== INPUT_POLICY.length
    || !Array.isArray(artifact.files)
    || artifact.files.length !== ORIGIN_PAYLOAD_PATHS.length
  ) throw new Error('WEB_ARTIFACT_POLICY_INVALID');
  for (const [index, entry] of artifact.inputs.entries()) {
    assertExactKeys(entry, ['path', 'size', 'sha256', 'kind'], 'WEB_ARTIFACT_INPUT');
    const [path, kind] = INPUT_POLICY[index];
    if (
      entry.path !== path
      || entry.kind !== kind
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || typeof entry.sha256 !== 'string'
      || !SHA256.test(entry.sha256)
    ) throw new Error('WEB_ARTIFACT_INPUT_INVALID');
  }
  for (const [index, entry] of artifact.files.entries()) {
    assertExactKeys(entry, ['path', 'size', 'sha256', 'mediaType', 'deployMode', 'kind'], 'WEB_ARTIFACT_FILE');
    const path = ORIGIN_PAYLOAD_PATHS[index];
    if (
      entry.path !== path
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || typeof entry.sha256 !== 'string'
      || !SHA256.test(entry.sha256)
      || entry.mediaType !== expectedMediaType(path)
      || entry.deployMode !== '0644'
      || entry.kind !== expectedKind(path)
    ) throw new Error(`WEB_ARTIFACT_FILE_INVALID: ${path}`);
  }
  const policy = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-public-web-v1',
    appId: 'DQ8PH2DZ3R.com.cabohealth.app',
    entrySlugs: ['healthy-recipes', 'clinic-guide'],
    legalSlugs: ['privacy', 'terms', 'support', 'report-content'],
    promoteTargets: [...PROMOTE_TARGETS],
    files: artifact.files,
  };
  const inventorySha256 = sha256(Buffer.from(canonicalJson(policy)));
  if (
    artifact.inventorySha256 !== inventorySha256
    || artifact.releaseId !== `web-v1-${inventorySha256}`
    || artifact.releaseId !== authority.reviewedReleaseId
    || sha256(Buffer.from(canonicalJson(artifact))) !== authority.reviewedArtifactSha256
  ) throw new Error('WEB_ARTIFACT_AUTHORITY_RECONCILIATION_FAILED');
  return artifact;
}

export function createUnknownSlug() {
  return `task-8-unknown-${randomBytes(16).toString('hex')}`;
}

function assertActionPath(path) {
  const protectedPaths = new Set([
    '/',
    '/apps/',
    '/apps/.htaccess',
    ...ORIGIN_PAYLOAD_PATHS.filter((item) => item !== 'apps/.htaccess').map(publicUrlPath),
  ]);
  if (
    typeof path !== 'string'
    || !path.startsWith('/')
    || path.startsWith('//')
    || path.includes('\\')
    || /[?#\u0000-\u001f\u007f]/u.test(path)
    || /(?:^|\/)\.\.?(?:\/|$)/u.test(path)
    || /%2e|%2f|%5c/iu.test(path)
    || protectedPaths.has(path)
  ) throw new Error('SENSITIVE_CONTROLS_INVALID');
}

export function validateSensitiveControls(value) {
  assertExactKeys(value, [
    'unrelatedPath',
    'unrelatedExpectedStatuses',
    'terminalPath',
    'terminalExpectedStatuses',
  ], 'SENSITIVE_CONTROLS');
  assertActionPath(value.unrelatedPath);
  assertActionPath(value.terminalPath);
  if (
    value.unrelatedPath === value.terminalPath
    || JSON.stringify(value.unrelatedExpectedStatuses) !== JSON.stringify([200])
    || !Array.isArray(value.terminalExpectedStatuses)
    || value.terminalExpectedStatuses.length < 1
    || value.terminalExpectedStatuses.length > 3
    || value.terminalExpectedStatuses.some((status, index, array) => (
      ![403, 404, 410].includes(status) || (index > 0 && array[index - 1] >= status)
    ))
  ) throw new Error('SENSITIVE_CONTROLS_INVALID');
  return value;
}

export function validateServerInventoryEvidence(value, artifact, authority) {
  validateArtifactAuthority(artifact, authority);
  assertExactKeys(value, [
    'schemaVersion',
    'artifactKind',
    'status',
    'releaseId',
    'rootCount',
    'fileCount',
    'paths',
    'inventorySha256',
  ], 'SERVER_INVENTORY');
  if (
    value.schemaVersion !== 1
    || value.artifactKind !== 'cabohealth-server-inventory-v1'
    || value.status !== 'verified'
    || value.releaseId !== artifact.releaseId
    || value.rootCount !== 3
    || value.fileCount !== ORIGIN_PAYLOAD_PATHS.length
    || JSON.stringify(value.paths) !== JSON.stringify(ORIGIN_PAYLOAD_PATHS)
    || value.inventorySha256 !== artifact.inventorySha256
  ) throw new Error('SERVER_INVENTORY_INVALID');
  return true;
}

const BROWSER_VIEWPORTS = Object.freeze([
  Object.freeze({ id: 'iphone-390x844', width: 390, height: 844 }),
  Object.freeze({ id: 'compact-320x568', width: 320, height: 568 }),
]);
const BROWSER_LOCALES = Object.freeze(['en-US', 'es-MX']);
const BROWSER_JAVASCRIPT_MODES = Object.freeze(['enabled', 'disabled']);
const browserRunnerReceipts = new WeakSet();

function browserRoutes(artifact) {
  return artifact.files
    .filter(({ path }) => path.endsWith('.html'))
    .map(({ path }) => publicUrlPath(path));
}

export function browserEvidenceSha256(value) {
  return sha256(Buffer.from(canonicalJson(value)));
}

export function validateBrowserEvidence(value, artifact, authority, reviewedMeasurement = undefined) {
  validateArtifactAuthority(artifact, authority);
  assertExactKeys(value, [
    'schemaVersion',
    'artifactKind',
    'status',
    'releaseId',
    'artifactSha256',
    'checkedAt',
    'nonceSha256',
    'routes',
    'observations',
  ], 'BROWSER_EVIDENCE');
  const runnerCreated = browserRunnerReceipts.has(value);
  if (!runnerCreated) {
    if (reviewedMeasurement === undefined) throw new Error('BROWSER_RUNNER_RECEIPT_REQUIRED');
    assertExactKeys(
      reviewedMeasurement,
      ['reviewedBrowserMeasurementSha256'],
      'REVIEWED_BROWSER_MEASUREMENT',
    );
    if (
      typeof reviewedMeasurement.reviewedBrowserMeasurementSha256 !== 'string'
      || !SHA256.test(reviewedMeasurement.reviewedBrowserMeasurementSha256)
      || reviewedMeasurement.reviewedBrowserMeasurementSha256 !== browserEvidenceSha256(value)
    ) throw new Error('BROWSER_RUNNER_RECEIPT_REQUIRED');
  }
  const routes = browserRoutes(artifact);
  if (
    value.schemaVersion !== 1
    || value.artifactKind !== 'cabohealth-browser-measurement-v1'
    || value.status !== 'verified'
    || value.releaseId !== artifact.releaseId
    || value.artifactSha256 !== authority.reviewedArtifactSha256
    || !isCanonicalUtcTimestamp(value.checkedAt)
    || typeof value.nonceSha256 !== 'string'
    || !SHA256.test(value.nonceSha256)
    || JSON.stringify(value.routes) !== JSON.stringify(routes)
    || !Array.isArray(value.observations)
    || value.observations.length !== BROWSER_VIEWPORTS.length * BROWSER_LOCALES.length
      * BROWSER_JAVASCRIPT_MODES.length * routes.length
  ) throw new Error('BROWSER_EVIDENCE_INVALID');
  let index = 0;
  for (const viewport of BROWSER_VIEWPORTS) {
    for (const locale of BROWSER_LOCALES) {
      for (const javascript of BROWSER_JAVASCRIPT_MODES) {
        for (const path of routes) {
          const observation = value.observations[index];
          assertExactKeys(observation, [
            'path',
            'requestedViewport',
            'requestedLocale',
            'javascript',
            'actualWidth',
            'actualHeight',
            'visualWidth',
            'visualHeight',
            'effectiveLocale',
            'documentUrl',
            'readyState',
            'bodyTextLength',
            'canonicalHref',
            'javascriptSentinel',
            'reducedMotionMatches',
            'animationSuppressed',
            'pauseKeyboardVerified',
            'focusVerified',
            'navigationVerified',
            'documentRequestSeen',
            'unexpectedRequestCount',
            'consoleErrorCount',
            'miniappReady',
            'noJsControlsDisabled',
            'bilingualStaticVisible',
            'challengeSha256',
          ], 'BROWSER_OBSERVATION');
          const expectedUrl = new URL(path, 'https://cabohealth.org/').href;
          const miniapp = path.startsWith('/apps/');
          const expectedSentinel = miniapp
            ? (javascript === 'enabled' ? 'enhanced' : 'static')
            : 'not-applicable';
          if (
            observation.path !== path
            || observation.requestedViewport !== viewport.id
            || observation.requestedLocale !== locale
            || observation.javascript !== javascript
            || observation.actualWidth !== viewport.width
            || observation.actualHeight !== viewport.height
            || observation.visualWidth !== viewport.width
            || observation.visualHeight !== viewport.height
            || observation.effectiveLocale !== locale
            || observation.documentUrl !== expectedUrl
            || observation.readyState !== 'complete'
            || !Number.isSafeInteger(observation.bodyTextLength)
            || observation.bodyTextLength <= 0
            || observation.canonicalHref !== expectedUrl
            || observation.javascriptSentinel !== expectedSentinel
            || observation.reducedMotionMatches !== true
            || observation.animationSuppressed !== true
            || observation.pauseKeyboardVerified !== true
            || observation.focusVerified !== true
            || observation.navigationVerified !== true
            || observation.documentRequestSeen !== true
            || observation.unexpectedRequestCount !== 0
            || observation.consoleErrorCount !== 0
            || typeof observation.miniappReady !== 'boolean'
            || observation.miniappReady !== (miniapp && javascript === 'enabled')
            || observation.noJsControlsDisabled !== true
            || observation.bilingualStaticVisible !== true
            || typeof observation.challengeSha256 !== 'string'
            || !SHA256.test(observation.challengeSha256)
          ) throw new Error(`BROWSER_EVIDENCE_INVALID: ${path}:${index}`);
          index += 1;
        }
      }
    }
  }
  return true;
}

function assertLoopbackWebDriverUrl(value) {
  const parsed = new URL(value);
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', '[::1]'].includes(parsed.hostname)
    || !parsed.port
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) throw new Error('WEBDRIVER_NETWORK_FORBIDDEN');
  return parsed;
}

async function webdriverCommand(base, path, method = 'POST', body = undefined) {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: 'manual',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status !== 200 || response.url !== new URL(path, base).href) {
    throw new Error(`WEBDRIVER_RESPONSE_INVALID: ${path}`);
  }
  const envelope = await response.json();
  assertExactKeys(envelope, ['value'], 'WEBDRIVER_ENVELOPE');
  return envelope.value;
}

function browserObservationChallenge(nonce, binding) {
  return sha256(Buffer.concat([nonce, Buffer.from(canonicalJson(binding))]));
}

function completedPerformanceRequests(logs, priorRequestIds = new Set()) {
  if (!Array.isArray(logs)) throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
  const requests = new Map();
  let sequence = 0;
  for (const entry of logs) {
    if (!entry || typeof entry.message !== 'string') throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
    let parsed;
    try {
      parsed = JSON.parse(entry.message);
    } catch {
      throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
    }
    const method = parsed?.message?.method;
    if (typeof method !== 'string' || method.length === 0) {
      throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
    }
    if (![
      'Network.requestWillBeSent',
      'Network.responseReceived',
      'Network.loadingFinished',
      'Network.loadingFailed',
    ].includes(method)) continue;
    const params = parsed.message.params;
    const requestId = params?.requestId;
    if (typeof requestId !== 'string' || requestId.length === 0) {
      throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
    }
    if (method === 'Network.requestWillBeSent') {
      const url = params?.request?.url;
      const httpMethod = params?.request?.method;
      const type = params?.type;
      const frameId = params?.frameId;
      const loaderId = params?.loaderId;
      const documentURL = params?.documentURL;
      if (
        typeof url !== 'string'
        || url.length === 0
        || typeof httpMethod !== 'string'
        || httpMethod.length === 0
        || typeof type !== 'string'
        || type.length === 0
        || typeof frameId !== 'string'
        || frameId.length === 0
        || typeof loaderId !== 'string'
        || loaderId.length === 0
        || typeof documentURL !== 'string'
        || documentURL.length === 0
      ) {
        throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
      }
      const prior = requests.get(requestId);
      if (prior !== undefined) {
        const redirect = params.redirectResponse;
        if (
          prior.finished
          || prior.failed
          || prior.responseStatus !== null
          || !redirect
          || redirect.url !== prior.url
          || !Number.isInteger(redirect.status)
          || redirect.status < 300
          || redirect.status >= 400
        ) throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
        prior.redirectResponse = { url: redirect.url, status: redirect.status };
        prior.redirectTarget = url;
        throw new Error('BROWSER_NETWORK_REDIRECT_FORBIDDEN');
      }
      if (params.redirectResponse !== undefined) {
        throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
      }
      if (priorRequestIds.has(requestId)) throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
      requests.set(requestId, {
        requestId,
        url,
        method: httpMethod,
        type,
        frameId,
        loaderId,
        documentURL,
        redirectResponse: null,
        redirectTarget: null,
        responseStatus: null,
        responseType: null,
        responseFrameId: null,
        responseLoaderId: null,
        finished: false,
        failed: false,
        sequence: sequence++,
      });
      continue;
    }
    const request = requests.get(requestId);
    if (request === undefined) throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
    if (method === 'Network.responseReceived') {
      const status = params?.response?.status;
      if (
        request.responseStatus !== null
        || request.finished
        || request.failed
        || params?.response?.url !== request.url
        || params?.type !== request.type
        || params?.frameId !== request.frameId
        || params?.loaderId !== request.loaderId
        || !Number.isInteger(status)
        || status < 100
        || status > 599
      ) throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
      if (status < 200 || status >= 300) throw new Error('BROWSER_NETWORK_STATUS_INVALID');
      request.responseStatus = status;
      request.responseType = params.type;
      request.responseFrameId = params.frameId;
      request.responseLoaderId = params.loaderId;
      continue;
    }
    if (request.finished || request.failed) throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
    if (method === 'Network.loadingFailed') {
      if (params?.type !== request.type) throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
      request.failed = true;
      throw new Error('BROWSER_NETWORK_LOADING_FAILED');
    }
    if (request.responseStatus === null) throw new Error('WEBDRIVER_PERFORMANCE_LOG_INVALID');
    request.finished = true;
  }
  for (const request of requests.values()) {
    if (request.responseStatus === null || !request.finished || request.failed) {
      throw new Error('BROWSER_NETWORK_REQUEST_INCOMPLETE');
    }
    priorRequestIds.add(request.requestId);
  }
  return [...requests.values()];
}

function validateBrowserRequestGraph(requests, { url, navigationHref, javascript }, sessionState) {
  if (
    !Array.isArray(requests)
    || typeof navigationHref !== 'string'
    || !LEGAL_URLS.includes(navigationHref)
    || !sessionState
    || !(sessionState.documentLoaderIds instanceof Set)
    || (sessionState.mainFrameId !== null && typeof sessionState.mainFrameId !== 'string')
  ) {
    throw new Error('BROWSER_NETWORK_GRAPH_INVALID');
  }
  const documents = requests
    .filter(({ type }) => type === 'Document')
    .sort((left, right) => left.sequence - right.sequence);
  if (documents.length !== 2) throw new Error('BROWSER_NETWORK_GRAPH_INVALID');
  const [originalDocument, navigationDocument] = documents;
  if (
    originalDocument.url !== url
    || originalDocument.method !== 'GET'
    || originalDocument.documentURL !== url
    || navigationDocument.url !== navigationHref
    || navigationDocument.method !== 'GET'
    || navigationDocument.documentURL !== navigationHref
    || navigationDocument.frameId !== originalDocument.frameId
    || navigationDocument.loaderId === originalDocument.loaderId
    || originalDocument.sequence !== 0
    || navigationDocument.sequence !== requests.length - 1
    || (sessionState.mainFrameId !== null && originalDocument.frameId !== sessionState.mainFrameId)
    || sessionState.documentLoaderIds.has(originalDocument.loaderId)
    || sessionState.documentLoaderIds.has(navigationDocument.loaderId)
  ) throw new Error('BROWSER_NETWORK_GRAPH_INVALID');

  const miniapp = new URL(url).pathname.startsWith('/apps/');
  const expectedResources = miniapp ? [
    ['https://cabohealth.org/apps/shared/styles.css', 'Stylesheet'],
    ['https://cabohealth.org/apps/shared/logo.png', 'Image'],
    ...(javascript === 'enabled' ? [
      [new URL('app.js', url).href, 'Script'],
      ['https://cabohealth.org/apps/shared/motion.js', 'Script'],
      ['https://cabohealth.org/apps/shared/shell.js', 'Script'],
    ] : []),
  ] : [];
  const resources = requests.filter(({ type }) => type !== 'Document');
  if (resources.length !== expectedResources.length) throw new Error('BROWSER_NETWORK_GRAPH_INVALID');
  const remaining = [...expectedResources];
  for (const request of resources) {
    if (
      request.method !== 'GET'
      || request.frameId !== originalDocument.frameId
      || request.loaderId !== originalDocument.loaderId
      || request.documentURL !== url
    ) throw new Error('BROWSER_NETWORK_GRAPH_INVALID');
    const expectedIndex = remaining.findIndex(([resourceUrl, type]) => (
      request.url === resourceUrl && request.type === type
    ));
    if (expectedIndex < 0) throw new Error('BROWSER_NETWORK_GRAPH_INVALID');
    remaining.splice(expectedIndex, 1);
  }
  if (remaining.length !== 0) throw new Error('BROWSER_NETWORK_GRAPH_INVALID');
  if (sessionState.mainFrameId === null) sessionState.mainFrameId = originalDocument.frameId;
  sessionState.documentLoaderIds.add(originalDocument.loaderId);
  sessionState.documentLoaderIds.add(navigationDocument.loaderId);
  return true;
}

async function webdriverKeyAction(webdriver, sessionId, value) {
  await webdriverCommand(webdriver, `/session/${sessionId}/actions`, 'POST', {
    actions: [{
      type: 'key',
      id: 'cabohealth-browser-keyboard',
      actions: [
        { type: 'keyDown', value },
        { type: 'keyUp', value },
      ],
    }],
  });
}

export async function measureBrowserEvidence({
  artifact,
  reviewedReleaseId,
  reviewedArtifactSha256,
  baseUrl,
  webdriverUrl,
  productionConfirmation = null,
  checkedAt = new Date().toISOString(),
}) {
  const authority = { reviewedReleaseId, reviewedArtifactSha256 };
  validateArtifactAuthority(artifact, authority);
  const base = assertAllowedBaseUrl(baseUrl, productionConfirmation);
  if (base.href !== 'https://cabohealth.org/') throw new Error('BROWSER_PRODUCTION_ORIGIN_REQUIRED');
  const webdriver = assertLoopbackWebDriverUrl(webdriverUrl);
  const nonce = randomBytes(16);
  if (!isCanonicalUtcTimestamp(checkedAt)) {
    throw new Error('BROWSER_MEASUREMENT_INPUT_INVALID');
  }
  const routes = browserRoutes(artifact);
  const allowedUrls = artifact.files
    .filter(({ path }) => path !== 'apps/.htaccess')
    .map(({ path }) => new URL(publicUrlPath(path), base).href);
  const observations = [];
  for (const viewport of BROWSER_VIEWPORTS) {
    for (const locale of BROWSER_LOCALES) {
      for (const javascript of BROWSER_JAVASCRIPT_MODES) {
        const chromePreferences = {
          'intl.accept_languages': locale,
          'profile.managed_default_content_settings.javascript': javascript === 'enabled' ? 1 : 2,
        };
        const created = await webdriverCommand(webdriver, '/session', 'POST', {
          capabilities: {
            alwaysMatch: {
              browserName: 'chrome',
              acceptInsecureCerts: false,
              pageLoadStrategy: 'normal',
              'goog:chromeOptions': {
                prefs: chromePreferences,
                mobileEmulation: {
                  deviceMetrics: {
                    width: viewport.width,
                    height: viewport.height,
                    pixelRatio: 3,
                    mobile: true,
                    touch: true,
                  },
                },
              },
              'goog:loggingPrefs': { browser: 'ALL', performance: 'ALL' },
            },
          },
        });
        const sessionId = created?.sessionId;
        if (
          typeof sessionId !== 'string'
          || !/^[A-Za-z0-9._-]+$/u.test(sessionId)
          || created?.capabilities?.browserName !== 'chrome'
          || created.capabilities.acceptInsecureCerts !== false
          || created.capabilities.pageLoadStrategy !== 'normal'
        ) {
          throw new Error('WEBDRIVER_SESSION_INVALID');
        }
        try {
          const performanceRequestIds = new Set();
          const browserNetworkSession = { mainFrameId: null, documentLoaderIds: new Set() };
          const logTypes = await webdriverCommand(webdriver, `/session/${sessionId}/log/types`, 'GET');
          if (!Array.isArray(logTypes) || !['browser', 'performance'].every((type) => logTypes.includes(type))) {
            throw new Error('WEBDRIVER_LOG_CAPABILITY_INVALID');
          }
          completedPerformanceRequests(await webdriverCommand(
            webdriver,
            `/session/${sessionId}/log`,
            'POST',
            { type: 'performance' },
          ), performanceRequestIds);
          for (const path of routes) {
            const url = new URL(path, base).href;
            const miniapp = path.startsWith('/apps/');
            const challenge = browserObservationChallenge(nonce, {
              releaseId: artifact.releaseId,
              artifactSha256: reviewedArtifactSha256,
              routes,
              path,
              viewport,
              locale,
              javascript,
            });
            const discardedBrowserLogs = await webdriverCommand(
              webdriver,
              `/session/${sessionId}/log`,
              'POST',
              { type: 'browser' },
            );
            if (!Array.isArray(discardedBrowserLogs)) throw new Error('WEBDRIVER_LOG_INVALID');
            if (discardedBrowserLogs.some(({ level } = {}) => ['SEVERE', 'ERROR'].includes(level))) {
              throw new Error('BROWSER_CONSOLE_ERROR');
            }
            await webdriverCommand(webdriver, `/session/${sessionId}/goog/cdp/execute`, 'POST', {
              cmd: 'Emulation.setEmulatedMedia',
              params: {
                media: '',
                features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
              },
            });
            await webdriverCommand(webdriver, `/session/${sessionId}/url`, 'POST', { url });
            const probe = async () => {
              const measured = await webdriverCommand(webdriver, `/session/${sessionId}/execute/sync`, 'POST', {
                script: `return (() => {
                const allowed = arguments[0];
                const challenge = arguments[1];
                const javascriptMode = arguments[2];
                const miniapp = location.pathname.startsWith('/apps/');
                const controls = [...document.querySelectorAll('[data-language], [data-motion-toggle], [data-recipe-search], [data-recipe-filter], [data-favorite-recipe], [data-checklist-item]')];
                const englishBlocks = [...document.querySelectorAll('[data-locale="en"], article[lang="en"]')];
                const spanishBlocks = [...document.querySelectorAll('[data-locale="es-MX"], article[lang="es-MX"]')];
                const visible = (node) => !node.hidden
                  && getComputedStyle(node).display !== 'none'
                  && getComputedStyle(node).visibility !== 'hidden';
                const active = document.activeElement;
                const activeStyle = active && active !== document.body ? getComputedStyle(active) : null;
                const activeHref = active?.tagName === 'A' ? active.href : null;
                const navigationHref = typeof activeHref === 'string'
                  && activeHref.startsWith('https://cabohealth.org/app/') ? activeHref : null;
                const focusTarget = active?.matches?.('[data-motion-toggle]')
                  ? 'motion-toggle'
                  : (navigationHref ? 'legal-link' : 'other');
                const motionToggle = document.querySelector('[data-motion-toggle]');
                const motionStatus = document.querySelector('[data-motion-status]');
                const motionStatusText = motionStatus?.textContent?.trim() ?? null;
                const staticMotionStatuses = new Set([
                  'A static composition is shown.',
                  'Se muestra una composición estática.',
                  'Static composition / Composición estática',
                ]);
                const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
                return {
                  documentUrl: location.href,
                  readyState: document.readyState,
                  bodyTextLength: (document.body?.innerText || '').trim().length,
                  canonicalHref: document.querySelector('link[rel="canonical"]')?.href || null,
                  actualWidth: innerWidth,
                  actualHeight: innerHeight,
                  visualWidth: visualViewport?.width ?? innerWidth,
                  visualHeight: visualViewport?.height ?? innerHeight,
                  effectiveLocale: navigator.language,
                  javascriptSentinel: miniapp ? (document.documentElement.dataset.enhanced === 'true' ? 'enhanced' : 'static') : 'not-applicable',
                  reducedMotionMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
                  animationSuppressed: document.getAnimations().every((animation) => animation.playState !== 'running'),
                  motionToggleDisabled: motionToggle?.disabled ?? true,
                  motionStatus: motionStatusText,
                  motionStatic: !miniapp || (motionToggle?.disabled === true && staticMotionStatuses.has(motionStatusText)),
                  focusTarget,
                  focusVerified: Boolean(activeStyle)
                    && activeStyle.outlineStyle !== 'none'
                    && Number.parseFloat(activeStyle.outlineWidth) > 0,
                  navigationHref,
                  unexpectedResourceCount: resources.filter((resource) => !allowed.includes(resource)).length,
                  miniappReady: miniapp && document.documentElement.dataset.enhanced === 'true',
                  noJsControlsDisabled: !miniapp || (javascriptMode === 'disabled' ? controls.length > 0 && controls.every((control) => control.disabled) : controls.some((control) => !control.disabled)),
                  bilingualStaticVisible: englishBlocks.length > 0
                    && spanishBlocks.length > 0
                    && (miniapp && javascriptMode === 'enabled'
                      ? true
                      : englishBlocks.some(visible) && spanishBlocks.some(visible)),
                  challengeEcho: challenge,
                };
              })();`,
                args: [allowedUrls, challenge, javascript],
              });
              if (measured?.challengeEcho !== challenge) throw new Error('BROWSER_RUNNER_CHALLENGE_INVALID');
              return measured;
            };
            const measured = await probe();
            let pauseKeyboardVerified = true;
            if (miniapp && javascript === 'enabled') {
              await webdriverCommand(webdriver, `/session/${sessionId}/goog/cdp/execute`, 'POST', {
                cmd: 'Emulation.setEmulatedMedia',
                params: {
                  media: '',
                  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
                },
              });
              let motionFocused = null;
              for (let attempt = 0; attempt < 64; attempt += 1) {
                await webdriverKeyAction(webdriver, sessionId, '\uE004');
                motionFocused = await probe();
                if (motionFocused.focusTarget === 'motion-toggle') break;
              }
              if (
                !motionFocused
                || motionFocused.focusTarget !== 'motion-toggle'
                || motionFocused.focusVerified !== true
                || motionFocused.reducedMotionMatches !== false
                || motionFocused.motionToggleDisabled !== false
              ) throw new Error('BROWSER_PAUSE_KEYBOARD_INVALID');
              const beforePause = motionFocused.motionStatus;
              await webdriverKeyAction(webdriver, sessionId, '\uE00D');
              const paused = await probe();
              await webdriverKeyAction(webdriver, sessionId, '\uE00D');
              const resumed = await probe();
              pauseKeyboardVerified = paused.focusTarget === 'motion-toggle'
                && paused.motionStatus !== beforePause
                && resumed.motionStatus === beforePause;
            }
            let navigationFocus = null;
            for (let attempt = 0; attempt < 96; attempt += 1) {
              await webdriverKeyAction(webdriver, sessionId, '\uE004');
              navigationFocus = await probe();
              if (
                navigationFocus.focusTarget === 'legal-link'
                && navigationFocus.focusVerified === true
                && allowedUrls.includes(navigationFocus.navigationHref)
              ) break;
            }
            const navigationHref = navigationFocus?.navigationHref;
            if (
              navigationFocus?.focusTarget !== 'legal-link'
              || navigationFocus.focusVerified !== true
              || typeof navigationHref !== 'string'
              || !allowedUrls.includes(navigationHref)
            ) throw new Error('BROWSER_KEYBOARD_FOCUS_INVALID');
            await webdriverKeyAction(webdriver, sessionId, '\uE007');
            const navigationVerified = await webdriverCommand(
              webdriver,
              `/session/${sessionId}/url`,
              'GET',
            ) === navigationHref;
            const browserLogs = await webdriverCommand(webdriver, `/session/${sessionId}/log`, 'POST', { type: 'browser' });
            if (!Array.isArray(browserLogs)) throw new Error('WEBDRIVER_LOG_INVALID');
            const performanceLogs = await webdriverCommand(webdriver, `/session/${sessionId}/log`, 'POST', { type: 'performance' });
            const performanceRequests = completedPerformanceRequests(performanceLogs, performanceRequestIds);
            validateBrowserRequestGraph(
              performanceRequests,
              { url, navigationHref, javascript },
              browserNetworkSession,
            );
            observations.push({
              path,
              requestedViewport: viewport.id,
              requestedLocale: locale,
              javascript,
              actualWidth: measured?.actualWidth,
              actualHeight: measured?.actualHeight,
              visualWidth: measured?.visualWidth,
              visualHeight: measured?.visualHeight,
              effectiveLocale: measured?.effectiveLocale,
              documentUrl: measured?.documentUrl,
              readyState: measured?.readyState,
              bodyTextLength: measured?.bodyTextLength,
              canonicalHref: measured?.canonicalHref,
              javascriptSentinel: measured?.javascriptSentinel,
              reducedMotionMatches: measured?.reducedMotionMatches,
              animationSuppressed: measured?.animationSuppressed === true
                && measured?.motionStatic === true,
              pauseKeyboardVerified,
              focusVerified: navigationFocus?.focusVerified,
              navigationVerified,
              documentRequestSeen: true,
              unexpectedRequestCount: measured?.unexpectedResourceCount ?? 0,
              consoleErrorCount: browserLogs.filter(({ level }) => ['SEVERE', 'ERROR'].includes(level)).length,
              miniappReady: measured?.miniappReady,
              noJsControlsDisabled: measured?.noJsControlsDisabled,
              bilingualStaticVisible: measured?.bilingualStaticVisible,
              challengeSha256: sha256(Buffer.from(challenge)),
            });
          }
        } finally {
          await webdriverCommand(webdriver, `/session/${sessionId}`, 'DELETE');
        }
      }
    }
  }
  const evidence = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-browser-measurement-v1',
    status: 'verified',
    releaseId: artifact.releaseId,
    artifactSha256: reviewedArtifactSha256,
    checkedAt,
    nonceSha256: sha256(nonce),
    routes,
    observations,
  };
  for (const observation of evidence.observations) Object.freeze(observation);
  Object.freeze(evidence.routes);
  Object.freeze(evidence.observations);
  Object.freeze(evidence);
  browserRunnerReceipts.add(evidence);
  validateBrowserEvidence(evidence, artifact, authority);
  return evidence;
}

function assertAllowedBaseUrl(baseUrl, productionConfirmation) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('ORIGIN_BASE_URL_INVALID');
  }
  if (
    productionConfirmation === 'cabohealth.org'
    && parsed.href === 'https://cabohealth.org/'
  ) return parsed;
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', '[::1]'].includes(parsed.hostname)
    || !parsed.port
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) throw new Error('ORIGIN_NETWORK_FORBIDDEN_WITHOUT_EXPLICIT_PRODUCTION_CONFIRMATION');
  return parsed;
}

function tags(text, name) {
  return text.match(new RegExp(`<${name}\\b[^>]*>`, 'giu')) ?? [];
}

function attribute(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu').exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function assertPublicHtml(path, bytes) {
  assertStaticWebPolicy(path, bytes);
  const text = bytes.toString('utf8');
  const expectedCanonical = `https://cabohealth.org/${path.replace(/index\.html$/u, '')}`;
  const canonicals = tags(text, 'link').filter((tag) => attribute(tag, 'rel')?.toLowerCase() === 'canonical');
  if (canonicals.length !== 1 || attribute(canonicals[0], 'href') !== expectedCanonical) {
    throw new Error(`ORIGIN_CANONICAL_INVALID: ${path}`);
  }
  const cspTags = tags(text, 'meta').filter((tag) => attribute(tag, 'http-equiv')?.toLowerCase() === 'content-security-policy');
  const expectedCsp = path.startsWith('apps/') ? CONTENT_SECURITY_POLICY : LEGAL_CSP;
  if (cspTags.length !== 1 || attribute(cspTags[0], 'content') !== expectedCsp) {
    throw new Error(`ORIGIN_META_CSP_INVALID: ${path}`);
  }
  for (const url of LEGAL_URLS) {
    if (!text.includes(`href="${url}"`) && !text.includes(`href='${url}'`)) {
      throw new Error(`ORIGIN_LEGAL_LINK_MISSING: ${path}`);
    }
  }
  if (
    /<(?:form|input|textarea|iframe|object|embed)\b/iu.test(text)
    || /\btarget\s*=\s*["']?_blank/iu.test(text)
    || /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/iu.test(text)
    || /<(?:script|img|iframe|source|video|audio)\b[^>]*\bsrc\s*=\s*["']?https?:/iu.test(text)
    || /<link\b(?=[^>]*\brel\s*=\s*["']?(?:stylesheet|preload|prefetch|modulepreload))[^>]*\bhref\s*=\s*["']?https?:/iu.test(text)
    || /@import\s+["']?https?:|url\(\s*["']?https?:|http:\/\//iu.test(text)
    || /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|Worker|SharedWorker)\s*\(/u.test(text)
    || /\bdocument\.cookie\b/u.test(text)
  ) throw new Error(`ORIGIN_ACTIVE_CONTENT_FORBIDDEN: ${path}`);
}

function assertPublicJavascript(path, bytes) {
  const text = bytes.toString('utf8');
  if (
    /http:\/\//iu.test(text)
    || /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|Worker|SharedWorker)\s*\(/u.test(text)
    || /\bdocument\.cookie\b/u.test(text)
    || /\bimport\s*\(/u.test(text)
  ) throw new Error(`ORIGIN_SCRIPT_NETWORK_SURFACE_FORBIDDEN: ${path}`);
}

async function exactFetch(base, path) {
  const expectedUrl = new URL(path, base).href;
  const response = await fetch(expectedUrl, { redirect: 'manual', headers: { 'Accept-Encoding': 'identity' } });
  if (response.url !== expectedUrl) throw new Error(`ORIGIN_FINAL_URL_INVALID: ${path}`);
  return response;
}

export async function verifyOrigin({
  artifact,
  reviewedReleaseId,
  reviewedArtifactSha256,
  baseUrl,
  sensitiveControls,
  productionConfirmation = null,
}) {
  validateArtifactAuthority(artifact, { reviewedReleaseId, reviewedArtifactSha256 });
  const controls = validateSensitiveControls(sensitiveControls);
  const base = assertAllowedBaseUrl(baseUrl, productionConfirmation);

  const rootResponse = await exactFetch(base, '/');
  if (rootResponse.status !== 200) throw new Error('ORIGIN_WORDPRESS_CONTROL_FAILED');
  await rootResponse.arrayBuffer();
  const unrelatedResponse = await exactFetch(base, controls.unrelatedPath);
  if (!controls.unrelatedExpectedStatuses.includes(unrelatedResponse.status)) {
    throw new Error('ORIGIN_UNRELATED_CONTROL_FAILED');
  }
  await unrelatedResponse.arrayBuffer();
  const terminalResponse = await exactFetch(base, controls.terminalPath);
  if (!controls.terminalExpectedStatuses.includes(terminalResponse.status)) {
    throw new Error('ORIGIN_TERMINAL_CONTROL_FAILED');
  }
  await terminalResponse.arrayBuffer();

  const urls = [];
  for (const entry of artifact.files) {
    if (entry.path === 'apps/.htaccess') continue;
    const urlPath = publicUrlPath(entry.path);
    const response = await exactFetch(base, urlPath);
    if (response.status !== 200) throw new Error(`ORIGIN_STATUS_INVALID: ${urlPath}`);
    if (response.headers.has('set-cookie')) throw new Error(`ORIGIN_SET_COOKIE_FORBIDDEN: ${urlPath}`);
    const contentType = response.headers.get('content-type');
    if (contentType !== entry.mediaType) throw new Error(`ORIGIN_CONTENT_TYPE_INVALID: ${urlPath}`);
    if (entry.path.startsWith('apps/')) {
      for (const [name, expected] of Object.entries(MINIAPP_SECURITY_HEADERS)) {
        if (response.headers.get(name) !== expected) throw new Error(`ORIGIN_SECURITY_HEADER_INVALID: ${urlPath}`);
      }
    } else if (entry.path.startsWith('app/')) {
      const responseCsp = response.headers.get('content-security-policy') ?? '';
      if (
        response.headers.get('x-frame-options') !== 'DENY'
        && !/(?:^|;)\s*frame-ancestors\s+'none'\s*(?:;|$)/u.test(responseCsp)
      ) throw new Error(`ORIGIN_LEGAL_FRAMING_UNPROTECTED: ${urlPath}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256) {
      throw new Error(`ORIGIN_BODY_HASH_INVALID: ${urlPath}`);
    }
    if (entry.path.endsWith('.html')) assertPublicHtml(entry.path, bytes);
    if (entry.path.endsWith('.js')) assertPublicJavascript(entry.path, bytes);
    if (entry.path === '.well-known/apple-app-site-association') {
      if (!bytes.equals(Buffer.from(canonicalAasaBytes(APP_ID), 'utf8'))) {
        throw new Error('ORIGIN_AASA_INVALID');
      }
    }
    urls.push({
      path: urlPath,
      status: 200,
      redirects: 0,
      contentType,
      sha256: entry.sha256,
      headerProfile: headerProfile(entry.path),
      cookieFree: true,
      canonical: true,
    });
  }

  const directoryResponse = await exactFetch(base, '/apps/');
  if (![403, 404].includes(directoryResponse.status)) throw new Error('ORIGIN_DIRECTORY_LISTING_EXPOSED');
  await directoryResponse.arrayBuffer();
  const htaccessResponse = await exactFetch(base, '/apps/.htaccess');
  if (![403, 404].includes(htaccessResponse.status)) throw new Error('ORIGIN_HTACCESS_EXPOSED');
  await htaccessResponse.arrayBuffer();
  const unknownSlug = createUnknownSlug();
  const unknownPath = `/apps/${unknownSlug}/`;
  const unknownResponse = await exactFetch(base, unknownPath);
  if (![404, 410].includes(unknownResponse.status)) throw new Error('ORIGIN_UNKNOWN_SLUG_NOT_MISSING');
  await unknownResponse.arrayBuffer();

  return {
    rootStatus: 200,
    unknownSlugStatus: unknownResponse.status,
    unknownSlugNonceSha256: sha256(Buffer.from(unknownSlug)),
    controls: { unrelatedAssetRetained: true, terminalRouteRetained: true },
    urls,
  };
}

export function validateProductionEvidence(evidence, artifact, authority, reviewedBrowserMeasurement) {
  validateArtifactAuthority(artifact, authority);
  assertExactKeys(evidence, [
    'schemaVersion',
    'artifactKind',
    'releaseId',
    'sourceCommit',
    'deployedAt',
    'origin',
    'serverInventory',
    'browser',
    'controls',
    'appleCdn',
    'rollback',
  ], 'PRODUCTION_EVIDENCE');
  if (
    evidence.schemaVersion !== 1
    || evidence.artifactKind !== 'cabohealth-production-verification'
    || typeof evidence.releaseId !== 'string'
    || !RELEASE_ID.test(evidence.releaseId)
    || evidence.releaseId !== artifact?.releaseId
    || artifact.inventorySha256 !== evidence.releaseId.slice('web-v1-'.length)
    || typeof evidence.sourceCommit !== 'string'
    || !COMMIT.test(evidence.sourceCommit)
    || !isCanonicalUtcTimestamp(evidence.deployedAt)
  ) throw new Error('PRODUCTION_EVIDENCE_RECONCILIATION_FAILED');

  assertExactKeys(evidence.origin, [
    'status',
    'checkedAt',
    'rootStatus',
    'unknownSlugStatus',
    'unknownSlugNonceSha256',
    'urls',
  ], 'PRODUCTION_ORIGIN');
  if (
    evidence.origin.status !== 'verified'
    || !isCanonicalUtcTimestamp(evidence.origin.checkedAt)
    || evidence.origin.rootStatus !== 200
    || ![404, 410].includes(evidence.origin.unknownSlugStatus)
    || typeof evidence.origin.unknownSlugNonceSha256 !== 'string'
    || !SHA256.test(evidence.origin.unknownSlugNonceSha256)
    || !Array.isArray(evidence.origin.urls)
  ) throw new Error('PRODUCTION_ORIGIN_INVALID');

  const expectedFiles = artifact?.files?.filter(({ path }) => path !== 'apps/.htaccess');
  if (!Array.isArray(expectedFiles) || evidence.origin.urls.length !== expectedFiles.length) {
    throw new Error('PRODUCTION_URL_SET_INVALID');
  }

  validateServerInventoryEvidence(evidence.serverInventory, artifact, authority);
  validateBrowserEvidence(evidence.browser, artifact, authority, reviewedBrowserMeasurement);
  assertExactKeys(evidence.controls, ['unrelatedAssetRetained', 'terminalRouteRetained'], 'PRODUCTION_CONTROLS');
  if (
    evidence.controls.unrelatedAssetRetained !== true
    || evidence.controls.terminalRouteRetained !== true
  ) throw new Error('PRODUCTION_CONTROLS_INVALID');
  for (const [index, expected] of expectedFiles.entries()) {
    const actual = evidence.origin.urls[index];
    assertExactKeys(actual, [
      'path',
      'status',
      'redirects',
      'contentType',
      'sha256',
      'headerProfile',
      'cookieFree',
      'canonical',
    ], 'PRODUCTION_URL');
    if (
      actual.path !== publicUrlPath(expected.path)
      || actual.status !== 200
      || actual.redirects !== 0
      || actual.contentType !== expected.mediaType
      || actual.sha256 !== expected.sha256
      || !SHA256.test(actual.sha256)
      || actual.headerProfile !== headerProfile(expected.path)
      || actual.cookieFree !== true
      || actual.canonical !== true
    ) throw new Error(`PRODUCTION_URL_INVALID: ${actual.path ?? index}`);
  }

  assertExactKeys(evidence.appleCdn, ['status', 'checkedAt', 'sha256'], 'APPLE_CDN');
  if (!isCanonicalUtcTimestamp(evidence.appleCdn.checkedAt)) throw new Error('APPLE_CDN_INVALID');
  const aasaHash = artifact.files.find(({ path }) => path === '.well-known/apple-app-site-association')?.sha256;
  if (
    !(
      evidence.appleCdn.status === 'pending-propagation'
      && evidence.appleCdn.sha256 === null
    )
    && !(
      evidence.appleCdn.status === 'verified'
      && typeof evidence.appleCdn.sha256 === 'string'
      && evidence.appleCdn.sha256 === aasaHash
    )
  ) throw new Error('APPLE_CDN_INVALID');

  assertExactKeys(evidence.rollback, ['version', 'stagedVerified', 'rehearsal'], 'ROLLBACK');
  if (
    typeof evidence.rollback.version !== 'string'
    || !ROLLBACK_ID.test(evidence.rollback.version)
    || evidence.rollback.stagedVerified !== true
    || evidence.rollback.rehearsal !== 'verified'
  ) throw new Error('ROLLBACK_EVIDENCE_INVALID');
  return true;
}

function parseCanonicalFile(path, label) {
  const raw = readFileSync(path, 'utf8');
  if (raw.startsWith('\ufeff')) throw new Error(`${label}_NONCANONICAL`);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label}_JSON_INVALID`);
  }
  if (`${JSON.stringify(value)}\n` !== raw) throw new Error(`${label}_NONCANONICAL`);
  return value;
}

export async function verifyAppleCdn({
  artifact,
  reviewedReleaseId,
  reviewedArtifactSha256,
  url = 'https://app-site-association.cdn-apple.com/a/v1/cabohealth.org',
  productionConfirmation = null,
}) {
  validateArtifactAuthority(artifact, { reviewedReleaseId, reviewedArtifactSha256 });
  const parsed = new URL(url);
  const productionUrl = 'https://app-site-association.cdn-apple.com/a/v1/cabohealth.org';
  const local = parsed.protocol === 'http:'
    && ['127.0.0.1', '[::1]'].includes(parsed.hostname)
    && Boolean(parsed.port)
    && !parsed.username
    && !parsed.password
    && !parsed.search
    && !parsed.hash;
  if (!(local || (productionConfirmation === 'cabohealth.org' && parsed.href === productionUrl))) {
    throw new Error('APPLE_CDN_NETWORK_FORBIDDEN_WITHOUT_EXPLICIT_PRODUCTION_CONFIRMATION');
  }
  const response = await fetch(parsed.href, { redirect: 'manual', headers: { 'Accept-Encoding': 'identity' } });
  if (response.url !== parsed.href || response.status !== 200) throw new Error('APPLE_CDN_RESPONSE_INVALID');
  if (response.headers.has('set-cookie')) throw new Error('APPLE_CDN_SET_COOKIE_FORBIDDEN');
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (!['application/json', 'application/pkcs7-mime'].includes(contentType ?? '')) {
    throw new Error('APPLE_CDN_CONTENT_TYPE_INVALID');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const expected = artifact?.files?.find(({ path }) => path === '.well-known/apple-app-site-association');
  if (!expected || bytes.byteLength !== expected.size || sha256(bytes) !== expected.sha256) {
    throw new Error('APPLE_CDN_PENDING_PROPAGATION');
  }
  if (!bytes.equals(Buffer.from(canonicalAasaBytes(APP_ID), 'utf8'))) throw new Error('APPLE_CDN_AASA_INVALID');
  return { status: 'verified', sha256: expected.sha256 };
}

export function checkSanitizedProductionEvidence(
  root = projectRoot,
  authority = undefined,
  reviewedBrowserMeasurement = undefined,
) {
  const evidencePath = resolve(root, 'release/production-urls.json');
  if (!existsSync(evidencePath)) throw new Error('PRODUCTION_EVIDENCE_MISSING');
  const artifactPath = resolve(root, 'release/web-artifacts.json');
  if (!existsSync(artifactPath)) throw new Error('WEB_ARTIFACT_EVIDENCE_MISSING');
  const evidence = parseCanonicalFile(evidencePath, 'PRODUCTION_EVIDENCE');
  const artifact = parseCanonicalFile(artifactPath, 'WEB_ARTIFACT_EVIDENCE');
  validateProductionEvidence(evidence, artifact, authority, reviewedBrowserMeasurement);
  if (evidence.appleCdn.status !== 'verified') throw new Error('APPLE_CDN_PENDING_PROPAGATION');
  return true;
}

function optionValue(arguments_, name) {
  const prefix = `--${name}=`;
  const matches = arguments_.filter((argument) => argument.startsWith(prefix));
  if (matches.length !== 1) throw new Error(`CLI_OPTION_INVALID: ${name}`);
  return matches[0].slice(prefix.length);
}

function assertArgumentSet(arguments_, expected) {
  if (
    arguments_.length !== expected.length
    || [...arguments_].sort().some((argument, index) => argument !== [...expected].sort()[index])
  ) throw new Error('CLI_ARGUMENT_SET_INVALID');
}

function reviewedAuthority(arguments_) {
  return {
    reviewedReleaseId: optionValue(arguments_, 'reviewed-release-id'),
    reviewedArtifactSha256: optionValue(arguments_, 'reviewed-artifact-sha256'),
  };
}

function reviewedBrowserMeasurement(arguments_) {
  return {
    reviewedBrowserMeasurementSha256: optionValue(arguments_, 'reviewed-browser-measurement-sha256'),
  };
}

function parseCanonicalStdin(label) {
  const raw = readFileSync(0, 'utf8');
  if (raw.startsWith('\ufeff')) throw new Error(`${label}_NONCANONICAL`);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label}_JSON_INVALID`);
  }
  if (canonicalJson(value) !== raw) throw new Error(`${label}_NONCANONICAL`);
  return value;
}

async function runCli() {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === '--check') {
    if (arguments_.length > 1) assertArgumentSet(arguments_.slice(1), [
      `--reviewed-release-id=${optionValue(arguments_.slice(1), 'reviewed-release-id')}`,
      `--reviewed-artifact-sha256=${optionValue(arguments_.slice(1), 'reviewed-artifact-sha256')}`,
      `--reviewed-browser-measurement-sha256=${optionValue(arguments_.slice(1), 'reviewed-browser-measurement-sha256')}`,
    ]);
    const authority = arguments_.length === 1 ? undefined : reviewedAuthority(arguments_.slice(1));
    const browserMeasurement = arguments_.length === 1
      ? undefined
      : reviewedBrowserMeasurement(arguments_.slice(1));
    checkSanitizedProductionEvidence(projectRoot, authority, browserMeasurement);
    console.log('Sanitized production evidence verified.');
    return;
  }
  if (
    arguments_[0] === '--verify-production-origin'
    && arguments_.includes('--confirm-production=cabohealth.org')
  ) {
    assertArgumentSet(arguments_.slice(1), [
      '--confirm-production=cabohealth.org',
      `--reviewed-release-id=${optionValue(arguments_.slice(1), 'reviewed-release-id')}`,
      `--reviewed-artifact-sha256=${optionValue(arguments_.slice(1), 'reviewed-artifact-sha256')}`,
    ]);
    const authority = reviewedAuthority(arguments_.slice(1));
    const artifact = parseCanonicalFile(resolve(projectRoot, 'release/web-artifacts.json'), 'WEB_ARTIFACT_EVIDENCE');
    const result = await verifyOrigin({
      artifact,
      ...authority,
      baseUrl: 'https://cabohealth.org',
      sensitiveControls: validateSensitiveControls(parseCanonicalStdin('SENSITIVE_CONTROLS')),
      productionConfirmation: 'cabohealth.org',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (
    arguments_[0] === '--verify-apple-cdn'
    && arguments_.includes('--confirm-production=cabohealth.org')
  ) {
    assertArgumentSet(arguments_.slice(1), [
      '--confirm-production=cabohealth.org',
      `--reviewed-release-id=${optionValue(arguments_.slice(1), 'reviewed-release-id')}`,
      `--reviewed-artifact-sha256=${optionValue(arguments_.slice(1), 'reviewed-artifact-sha256')}`,
    ]);
    const authority = reviewedAuthority(arguments_.slice(1));
    const artifact = parseCanonicalFile(resolve(projectRoot, 'release/web-artifacts.json'), 'WEB_ARTIFACT_EVIDENCE');
    const result = await verifyAppleCdn({ artifact, ...authority, productionConfirmation: 'cabohealth.org' });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (
    arguments_[0] === '--measure-browser'
    && arguments_.includes('--confirm-production=cabohealth.org')
  ) {
    const webdriverUrl = optionValue(arguments_.slice(1), 'webdriver-url');
    assertArgumentSet(arguments_.slice(1), [
      '--confirm-production=cabohealth.org',
      `--reviewed-release-id=${optionValue(arguments_.slice(1), 'reviewed-release-id')}`,
      `--reviewed-artifact-sha256=${optionValue(arguments_.slice(1), 'reviewed-artifact-sha256')}`,
      `--webdriver-url=${webdriverUrl}`,
    ]);
    const authority = reviewedAuthority(arguments_.slice(1));
    const artifact = parseCanonicalFile(resolve(projectRoot, 'release/web-artifacts.json'), 'WEB_ARTIFACT_EVIDENCE');
    const result = await measureBrowserEvidence({
      artifact,
      ...authority,
      baseUrl: 'https://cabohealth.org/',
      webdriverUrl,
      productionConfirmation: 'cabohealth.org',
      checkedAt: new Date().toISOString(),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error('Usage: node scripts/verify-production.mjs <--check|--verify-production-origin|--verify-apple-cdn|--measure-browser> [reviewed authority and explicit production confirmation]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
