import { spawnSync } from 'node:child_process';
import process from 'node:process';

const env = {
  ...process.env,
  EXPO_PUBLIC_APP_IA_V2: '1',
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
const { startDistributionServer } = await import('./serve-dist.mjs');
startDistributionServer({
  testRequestHandler(request, response) {
    if (!request.url?.startsWith('/api/events')) return false;

    response.writeHead(200, {
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream',
    });
    response.write(': connected\n\n');
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 10_000);
    heartbeat.unref?.();
    request.once('close', () => clearInterval(heartbeat));
    return true;
  },
});
