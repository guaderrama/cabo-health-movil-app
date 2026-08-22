import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

test('production backend source contains no logging or client PII fields', async () => {
  const sourceRoot = join(process.cwd(), 'src');
  const files = (await sourceFiles(sourceRoot)).filter((path) => !path.includes('/tests/'));
  const source = (await Promise.all(files.map((path) => readFile(path, 'utf8')))).join('\n');

  for (const forbidden of [
    /\bconsole\s*\./u,
    /\blogger\s*\./u,
    /clientReference/u,
    /clientName/u,
    /healthData/u,
    /health_data/u,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}
