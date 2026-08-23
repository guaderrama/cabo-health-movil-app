import { removeDurableOwnedTree } from '../../scripts/protected-overlay-transaction.mjs';

const [target, managedRoot] = process.argv.slice(2);

try {
  removeDurableOwnedTree(target, managedRoot, 'test_cleanup_invalid');
  process.stdout.write(`${JSON.stringify({ status: 'removed' })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
