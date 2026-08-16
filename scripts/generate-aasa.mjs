import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const AASA_COMPONENTS = Object.freeze([
  Object.freeze({ '/': '/apps/healthy-recipes/' }),
  Object.freeze({ '/': '/apps/clinic-guide/' }),
]);

export function readReleaseIdentity(root = process.cwd()) {
  const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8'));
  const eas = JSON.parse(readFileSync(resolve(root, 'eas.json'), 'utf8'));
  const teamId = eas?.submit?.production?.ios?.appleTeamId;
  const bundleIdentifier = app?.expo?.ios?.bundleIdentifier;
  if (typeof teamId !== 'string' || !/^[A-Z0-9]{10}$/u.test(teamId)) {
    throw new Error('Missing or invalid checked-in Apple team ID.');
  }
  if (typeof bundleIdentifier !== 'string' || bundleIdentifier.length === 0) {
    throw new Error('Missing checked-in iOS bundle identifier.');
  }
  return { app, appId: `${teamId}.${bundleIdentifier}` };
}

export function buildAasa(appId) {
  return {
    applinks: {
      details: [{
        appIDs: [appId],
        components: AASA_COMPONENTS,
      }],
    },
  };
}

export function canonicalAasaBytes(appId) {
  return `${JSON.stringify(buildAasa(appId), null, 2)}\n`;
}

export function generateAasa(outputPath, root = process.cwd()) {
  const { appId } = readReleaseIdentity(root);
  const bytes = canonicalAasaBytes(appId);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes, 'utf8');
  return bytes;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const outputPath = resolve(
    process.argv[2]
      ?? 'web-hosting/cabohealth.org/.well-known/apple-app-site-association',
  );
  generateAasa(outputPath);
  console.log('Generated canonical apple-app-site-association.');
}
