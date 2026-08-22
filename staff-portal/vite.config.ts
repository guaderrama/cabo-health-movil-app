import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, loadEnv, type Plugin } from 'vite';

import {
  STAFF_FUNCTIONS_REGION,
  resolveFunctionsOrigin,
} from './src/firebase/staffFirebaseConfig.js';

const FUNCTIONS_ORIGIN_TOKEN = '__CABOHEALTH_FUNCTIONS_ORIGIN__';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_FIREBASE_');
  const functionsOrigin = resolveFunctionsOrigin(
    environment.VITE_FIREBASE_PROJECT_ID,
    environment.VITE_FIREBASE_FUNCTIONS_REGION || STAFF_FUNCTIONS_REGION,
  );

  return {
    base: '/staff/',
    esbuild: { jsx: 'automatic' },
    plugins: [exactFunctionsOriginPlugin(functionsOrigin)],
    build: {
      emptyOutDir: true,
      minify: 'esbuild',
      outDir: 'dist',
      sourcemap: false,
    },
  };
});

function exactFunctionsOriginPlugin(functionsOrigin: string): Plugin {
  return {
    name: 'cabohealth-exact-functions-origin',
    transformIndexHtml: (html) => replaceOriginToken(html, functionsOrigin),
    closeBundle: () => {
      for (const fileName of ['.htaccess', '_headers']) {
        const outputPath = resolve(process.cwd(), 'dist', fileName);
        const source = readFileSync(outputPath, 'utf8');
        writeFileSync(outputPath, replaceOriginToken(source, functionsOrigin), 'utf8');
      }
    },
  };
}

function replaceOriginToken(source: string, functionsOrigin: string): string {
  if (!source.includes(FUNCTIONS_ORIGIN_TOKEN)) {
    throw new Error('functions_origin_token_missing');
  }
  return source.replaceAll(FUNCTIONS_ORIGIN_TOKEN, functionsOrigin);
}
