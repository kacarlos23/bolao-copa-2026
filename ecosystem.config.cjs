module.exports = {
  apps: [
    {
      name: 'bolao-api',
      cwd: './apps/api',
      script: 'dist/src/server.js',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: 'bolao-web',
      cwd: './apps/web',
      script: 'npx',
      args: 'expo start --web --port 8080',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
