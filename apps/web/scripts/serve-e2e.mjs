import { spawnSync } from 'node:child_process';
import process from 'node:process';

const env = {
  ...process.env,
  EXPO_PUBLIC_BRASILEIRAO_UI: '1',
  EXPO_PUBLIC_COMPETITION_UI_V2: '1',
  EXPO_PUBLIC_LEGACY_ADMIN_MUTATIONS: '1',
  PORT: process.env.PORT ?? '4173',
};
const build = spawnSync('npx expo export --platform web --clear', {
  env,
  stdio: 'inherit',
  shell: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);
Object.assign(process.env, env);
await import('./serve-dist.mjs');
