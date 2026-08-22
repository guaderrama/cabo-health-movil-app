import { durableRename } from '../../scripts/protected-overlay-transaction.mjs';

const [source, destination] = process.argv.slice(2);
durableRename(source, destination, 'test_durable_rename_failed');
