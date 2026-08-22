import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, loadEnv, type Plugin } from 'vite';

import {
  STAFF_FUNCTIONS_REGION,
  resolveFunctionsOrigin,
  type StaffDeploymentIdentity,
  validateStaffFirebaseConfig,
} from './src/firebase/staffFirebaseConfig.js';

const FUNCTIONS_ORIGIN_TOKEN = '__CABOHEALTH_FUNCTIONS_ORIGIN__';

export default defineConfig(({ mode }) => {
  const environment = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const rawConfig = {
    firebase: {
      apiKey: environment.VITE_FIREBASE_API_KEY,
      authDomain: environment.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: environment.VITE_FIREBASE_PROJECT_ID,
      appId: environment.VITE_FIREBASE_APP_ID,
    },
    appCheckSiteKey: environment.VITE_FIREBASE_APPCHECK_ENTERPRISE_SITE_KEY,
    functionsRegion: environment.VITE_FIREBASE_FUNCTIONS_REGION || STAFF_FUNCTIONS_REGION,
    deployment: {
      appEnv: environment.APP_ENV,
      expectedProjectId: environment.STAFF_EXPECTED_FIREBASE_PROJECT_ID,
      expectedWebAppId: environment.STAFF_EXPECTED_FIREBASE_WEB_APP_ID,
      backendStaffWebAppId: environment.STAFF_WEB_FIREBASE_APP_ID,
    },
  };
  let deploymentIdentity: StaffDeploymentIdentity | null = null;
  try {
    deploymentIdentity = validateStaffFirebaseConfig(rawConfig).deployment;
  } catch {
    if (mode === 'staff-release') throw new Error('staff_release_identity_invalid');
  }
  const functionsOrigin = resolveFunctionsOrigin(rawConfig);
  const buildIdentity = deploymentIdentity === null
    ? Object.freeze({ schemaVersion: 1, status: 'closed' as const })
    : Object.freeze({
      schemaVersion: 1,
      ...deploymentIdentity,
      functionsRegion: STAFF_FUNCTIONS_REGION,
      functionsOrigin,
    });

  return {
    base: '/staff/',
    define: {
      __STAFF_DEPLOYMENT_IDENTITY__: JSON.stringify(deploymentIdentity),
    },
    esbuild: { jsx: 'automatic' },
    plugins: [exactFunctionsOriginPlugin(functionsOrigin, buildIdentity)],
    build: {
      emptyOutDir: true,
      minify: 'esbuild',
      outDir: 'dist',
      sourcemap: false,
    },
  };
});

function exactFunctionsOriginPlugin(
  functionsOrigin: string,
  buildIdentity: Readonly<Record<string, unknown>>,
): Plugin {
  return {
    name: 'cabohealth-exact-functions-origin',
    transformIndexHtml: (html) => replaceOriginToken(html, functionsOrigin),
    closeBundle: () => {
      for (const fileName of ['.htaccess', '_headers']) {
        const outputPath = resolve(process.cwd(), 'dist', fileName);
        const source = readFileSync(outputPath, 'utf8');
        writeFileSync(outputPath, replaceOriginToken(source, functionsOrigin), 'utf8');
      }
      writeFileSync(
        resolve(process.cwd(), 'dist', 'staff-build-identity.json'),
        `${JSON.stringify(buildIdentity)}\n`,
        'utf8',
      );
    },
  };
}

function replaceOriginToken(source: string, functionsOrigin: string): string {
  if (!source.includes(FUNCTIONS_ORIGIN_TOKEN)) {
    throw new Error('functions_origin_token_missing');
  }
  return source.replaceAll(FUNCTIONS_ORIGIN_TOKEN, functionsOrigin);
}
