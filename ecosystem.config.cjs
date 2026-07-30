const path = require('node:path');

const releaseRoot = path.resolve(__dirname);
const releaseDirectoryName = path.basename(releaseRoot);
const releaseSha =
  process.env.APP_RELEASE_SHA ||
  (/^[a-f0-9]{7,40}$/i.test(releaseDirectoryName) ? releaseDirectoryName : 'development');
const productionRoot = process.env.PRODUCTION_ROOT
  ? path.resolve(process.env.PRODUCTION_ROOT)
  : null;

const externalEnvironment = Object.fromEntries(
  Object.entries({
    NODE_ENV: 'production',
    DOTENV_CONFIG_PATH:
      process.env.DOTENV_CONFIG_PATH || process.env.PRODUCTION_ENV_FILE || undefined,
    APP_RELEASE_SHA: releaseSha,
    AVATAR_UPLOAD_DIR: process.env.AVATAR_UPLOAD_DIR || undefined,
    PRODUCTION_WEB_URL: process.env.PRODUCTION_WEB_URL || undefined,
    PRODUCTION_API_URL: process.env.PRODUCTION_API_URL || undefined,
  }).filter(([, value]) => value !== undefined && value !== ''),
);

function persistentLogs(processName) {
  if (!productionRoot) return {};
  const logsRoot = path.join(productionRoot, 'logs');
  return {
    out_file: path.join(logsRoot, `${processName}-out.log`),
    error_file: path.join(logsRoot, `${processName}-error.log`),
    time: true,
  };
}

const gracefulProcessDefaults = {
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  wait_ready: true,
  listen_timeout: 30_000,
  kill_timeout: 15_000,
  shutdown_with_message: true,
  max_restarts: 10,
  restart_delay: 5_000,
  merge_logs: true,
};

module.exports = {
  apps: [
    {
      ...gracefulProcessDefaults,
      ...persistentLogs('bolao-api'),
      name: 'bolao-api',
      cwd: path.join(releaseRoot, 'apps', 'api'),
      script: path.join(releaseRoot, 'apps', 'api', 'dist', 'src', 'server.js'),
      interpreter: process.execPath,
      env: externalEnvironment,
    },
    {
      ...gracefulProcessDefaults,
      ...persistentLogs('bolao-web'),
      name: 'bolao-web',
      cwd: path.join(releaseRoot, 'apps', 'web'),
      script: path.join(releaseRoot, 'apps', 'web', 'scripts', 'serve-dist.mjs'),
      interpreter: process.execPath,
      env: {
        ...externalEnvironment,
        HOST: '127.0.0.1',
        PORT: '8080',
        API_ORIGIN: 'http://127.0.0.1:3001',
      },
    },
  ],
};
