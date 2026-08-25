'use strict';

const { DOMParser } = require('@xmldom/xmldom');

const STRICT_NATIVE_ENVIRONMENTS = new Set(['staging', 'production']);
const APP_ATTEST_ENTITLEMENT = 'com.apple.developer.devicecheck.appattest-environment';
const PRODUCTION_FIREBASE_PROJECT_ID = 'cabohealth-owner-prod';
const FIREBASE_IDENTITY_KEYS = new Set(['PROJECT_ID', 'BUNDLE_ID']);
const PLIST_VALUE_TAGS = new Set([
  'array',
  'data',
  'date',
  'dict',
  'false',
  'integer',
  'real',
  'string',
  'true',
]);
const XML_NODE = Object.freeze({
  comment: 8,
  doctype: 10,
  element: 1,
  processingInstruction: 7,
  text: 3,
});

function buildNativeFirebaseExpoConfig({
  baseConfig,
  env,
  fileExists,
  readFile,
}) {
  const appEnvironment = env.APP_ENV || 'development';
  if (!['development', 'staging', 'production'].includes(appEnvironment)) {
    throw new Error(`Unsupported APP_ENV: ${appEnvironment}`);
  }
  const appCheckDebugEnabled = env.CABOHEALTH_APP_CHECK_DEBUG === 'true';
  if (appCheckDebugEnabled && appEnvironment !== 'development') {
    throw new Error('App Check debug mode is allowed only in development builds');
  }
  const serviceFile = env.CABOHEALTH_GOOGLE_SERVICES_PLIST || null;
  if (
    STRICT_NATIVE_ENVIRONMENTS.has(appEnvironment)
    && !serviceFile
  ) {
    throw new Error(
      `CABOHEALTH_GOOGLE_SERVICES_PLIST is required for ${appEnvironment} builds`,
    );
  }
  if (!serviceFile) {
    return {
      ...baseConfig,
      extra: {
        ...(baseConfig.extra || {}),
        clientAccessRuntime: {
          appCheckDebugEnabled,
          appEnvironment,
          enabled: false,
          functionsRegion: 'us-central1',
        },
      },
    };
  }
  if (!fileExists(serviceFile)) {
    throw new Error(`CABOHEALTH_GOOGLE_SERVICES_PLIST does not exist for ${appEnvironment}`);
  }
  const expectedProjectId = env.CABOHEALTH_FIREBASE_PROJECT_ID || '';
  if (!isDedicatedCaboHealthProjectId(expectedProjectId)) {
    throw new Error('CABOHEALTH_FIREBASE_PROJECT_ID must identify a dedicated CaboHealth project');
  }
  if (
    appEnvironment === 'production'
    && expectedProjectId !== PRODUCTION_FIREBASE_PROJECT_ID
  ) {
    throw new Error(
      `CABOHEALTH_FIREBASE_PROJECT_ID must be ${PRODUCTION_FIREBASE_PROJECT_ID} for production`,
    );
  }
  let plistIdentity;
  try {
    plistIdentity = parseGoogleServicesPlistIdentity(readFile(serviceFile));
  } catch {
    throw new Error('GoogleService-Info.plist is not a valid canonical XML property list');
  }
  if (plistIdentity.projectId !== expectedProjectId) {
    throw new Error('GoogleService-Info.plist PROJECT_ID does not match this build environment');
  }
  if (plistIdentity.bundleId !== baseConfig.ios?.bundleIdentifier) {
    throw new Error('GoogleService-Info.plist BUNDLE_ID does not match the iOS bundle identifier');
  }

  return {
    ...baseConfig,
    ios: {
      ...(baseConfig.ios || {}),
      googleServicesFile: serviceFile,
      ...(STRICT_NATIVE_ENVIRONMENTS.has(appEnvironment) ? {
        entitlements: {
          ...(baseConfig.ios?.entitlements || {}),
          [APP_ATTEST_ENTITLEMENT]: 'production',
        },
      } : {}),
      privacyManifests: {
        NSPrivacyTracking: false,
        NSPrivacyTrackingDomains: [],
      },
    },
    plugins: [
      ...(baseConfig.plugins || []),
      '@react-native-firebase/app',
      '@react-native-firebase/auth',
      '@react-native-firebase/app-check',
      ['expo-secure-store', { faceIDPermission: false }],
      ['expo-build-properties', { ios: {
        privacyManifestAggregationEnabled: true,
        useFrameworks: 'static',
      } }],
    ],
    extra: {
      ...(baseConfig.extra || {}),
      clientAccessRuntime: {
        appCheckDebugEnabled,
        appEnvironment,
        enabled: true,
        expectedProjectId,
        functionsRegion: 'us-central1',
      },
    },
  };
}

function isDedicatedCaboHealthProjectId(value) {
  return /^cabohealth-[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/u.test(value);
}

function parseGoogleServicesPlistIdentity(source) {
  if (typeof source !== 'string' || source.length === 0 || source.includes('\0')) {
    throw invalidPlist();
  }

  const diagnostics = [];
  let document;
  try {
    document = new DOMParser({
      errorHandler: {
        error: (message) => diagnostics.push(message),
        fatalError: (message) => diagnostics.push(message),
        warning: (message) => diagnostics.push(message),
      },
    }).parseFromString(source, 'application/xml');
  } catch {
    throw invalidPlist();
  }
  if (diagnostics.length > 0 || !document?.documentElement) {
    throw invalidPlist();
  }

  const rawDoctypes = findRawDoctypes(source);
  const documentDoctypes = [];
  let rootElements = 0;
  for (const child of Array.from(document.childNodes)) {
    if (child.nodeType === XML_NODE.element) {
      rootElements += 1;
      continue;
    }
    if (child.nodeType === XML_NODE.doctype) {
      documentDoctypes.push(child);
      continue;
    }
    if (child.nodeType === XML_NODE.comment) continue;
    if (child.nodeType === XML_NODE.text && child.data.trim() === '') continue;
    if (child.nodeType === XML_NODE.processingInstruction && child.nodeName === 'xml') continue;
    throw invalidPlist();
  }
  if (rootElements !== 1
    || rawDoctypes.length !== documentDoctypes.length
    || rawDoctypes.length > 1) {
    throw invalidPlist();
  }
  if (rawDoctypes.length === 1) {
    validateApplePlistDoctype(rawDoctypes[0], documentDoctypes[0]);
  }

  const plist = document.documentElement;
  if (plist.tagName !== 'plist') throw invalidPlist();
  assertOnlyAttributes(plist, { version: '1.0' });
  const plistChildren = elementChildren(plist);
  if (plistChildren.length !== 1 || plistChildren[0].tagName !== 'dict') {
    throw invalidPlist();
  }

  const identity = Object.create(null);
  validatePlistValue(plistChildren[0], 0, identity);
  if (typeof identity.PROJECT_ID !== 'string'
    || typeof identity.BUNDLE_ID !== 'string') {
    throw invalidPlist();
  }
  return Object.freeze({
    bundleId: identity.BUNDLE_ID,
    projectId: identity.PROJECT_ID,
  });
}

function validatePlistValue(element, depth, identity) {
  if (!PLIST_VALUE_TAGS.has(element.tagName)) throw invalidPlist();
  assertOnlyAttributes(element);

  if (element.tagName === 'dict') {
    const children = elementChildren(element);
    if (children.length % 2 !== 0) throw invalidPlist();
    const keys = new Set();
    for (let index = 0; index < children.length; index += 2) {
      const keyElement = children[index];
      const valueElement = children[index + 1];
      if (keyElement.tagName !== 'key') throw invalidPlist();
      assertOnlyAttributes(keyElement);
      const key = scalarText(keyElement);
      if (keys.has(key)) throw invalidPlist();
      keys.add(key);
      if (FIREBASE_IDENTITY_KEYS.has(key)) {
        if (depth !== 0 || valueElement.tagName !== 'string') throw invalidPlist();
        identity[key] = scalarText(valueElement);
      }
      validatePlistValue(valueElement, depth + 1, identity);
    }
    return;
  }

  if (element.tagName === 'array') {
    for (const child of elementChildren(element)) {
      validatePlistValue(child, depth + 1, identity);
    }
    return;
  }

  if (element.tagName === 'true' || element.tagName === 'false') {
    if (elementChildren(element).length !== 0) throw invalidPlist();
    return;
  }

  scalarText(element);
}

function elementChildren(element) {
  const children = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === XML_NODE.element) {
      children.push(child);
      continue;
    }
    if (child.nodeType === XML_NODE.comment) continue;
    if (child.nodeType === XML_NODE.text && child.data.trim() === '') continue;
    throw invalidPlist();
  }
  return children;
}

function scalarText(element) {
  const children = Array.from(element.childNodes);
  if (children.length !== 1 || children[0].nodeType !== XML_NODE.text) {
    throw invalidPlist();
  }
  return children[0].data;
}

function assertOnlyAttributes(element, allowed = {}) {
  const attributes = Array.from(element.attributes || []);
  if (attributes.length !== Object.keys(allowed).length) throw invalidPlist();
  for (const attribute of attributes) {
    if (allowed[attribute.name] !== attribute.value) throw invalidPlist();
  }
}

function findRawDoctypes(source) {
  const doctypes = [];
  for (let index = 0; index < source.length;) {
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      if (end === -1) throw invalidPlist();
      index = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', index)) {
      const end = source.indexOf(']]>', index + 9);
      if (end === -1) throw invalidPlist();
      index = end + 3;
      continue;
    }
    if (!source.startsWith('<!DOCTYPE', index)) {
      index += 1;
      continue;
    }
    const start = index;
    let quote = null;
    let subsetDepth = 0;
    let end = -1;
    for (index += 9; index < source.length; index += 1) {
      const character = source[index];
      if (quote !== null) {
        if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '[') {
        subsetDepth += 1;
      } else if (character === ']') {
        subsetDepth -= 1;
        if (subsetDepth < 0) throw invalidPlist();
      } else if (character === '>' && subsetDepth === 0) {
        end = index + 1;
        break;
      }
    }
    if (end === -1 || quote !== null || subsetDepth !== 0) throw invalidPlist();
    doctypes.push(source.slice(start, end));
    index = end;
  }
  return doctypes;
}

function validateApplePlistDoctype(rawDoctype, documentDoctype) {
  const match = /^<!DOCTYPE[\t\n\r ]+plist[\t\n\r ]+PUBLIC[\t\n\r ]+(["'])-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN\1[\t\n\r ]+(["'])https?:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd\2[\t\n\r ]*>$/u.exec(
    rawDoctype,
  );
  if (!match
    || documentDoctype.nodeName !== 'plist'
    || unquoteDoctypeId(documentDoctype.publicId) !== '-//Apple//DTD PLIST 1.0//EN'
    || !/^https?:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd$/u.test(
      unquoteDoctypeId(documentDoctype.systemId),
    )) {
    throw invalidPlist();
  }
}

function unquoteDoctypeId(value) {
  if (typeof value !== 'string') return '';
  if ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function invalidPlist() {
  return new Error('Invalid GoogleService-Info.plist XML structure');
}

module.exports = {
  buildNativeFirebaseExpoConfig,
  parseGoogleServicesPlistIdentity,
};
