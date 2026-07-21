import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const expoCli = require.resolve('expo/bin/cli');
const releaseFlags = {
  EXPO_PUBLIC_APP_IA_V2: '1',
  EXPO_PUBLIC_BRASILEIRAO_UI: '1',
  EXPO_PUBLIC_COMPETITION_UI_V2: '1',
};

const result = spawnSync(
  process.execPath,
  [expoCli, 'export', '--platform', 'web', '--clear', '--max-workers', '1'],
  {
    env: { ...process.env, ...releaseFlags },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
