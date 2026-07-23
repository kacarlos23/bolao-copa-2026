import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('restore replica o modo de hashes de negócio do snapshot esperado', async () => {
  const script = await readFile(new URL('./restore-postgres.ps1', import.meta.url), 'utf8');

  assert.match(script, /businessContentHashes/);
  assert.match(script, /\$snapshotArguments = @\("--backfill"\) \+ \$snapshotArguments/);
  assert.match(
    script,
    /copa-snapshot\.mjs"\) @snapshotArguments/,
    'o snapshot restaurado deve receber a lista de argumentos ajustada',
  );
});
