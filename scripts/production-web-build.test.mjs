import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the production web build always publishes the approved competition experience', async () => {
  const packageJson = JSON.parse(await readFile('apps/web/package.json', 'utf8'));
  const buildScript = await readFile('apps/web/scripts/build-production.mjs', 'utf8');

  assert.equal(packageJson.scripts.build, 'node scripts/build-production.mjs');
  assert.match(buildScript, /EXPO_PUBLIC_APP_IA_V2:\s*'1'/);
  assert.match(buildScript, /EXPO_PUBLIC_BRASILEIRAO_UI:\s*'1'/);
  assert.match(buildScript, /EXPO_PUBLIC_COMPETITION_UI_V2:\s*'1'/);
  assert.match(buildScript, /expoCli,\s*'export',\s*'--platform',\s*'web',\s*'--clear'/);
});
