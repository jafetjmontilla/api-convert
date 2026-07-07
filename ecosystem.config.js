const path = require('path');

module.exports = {
  apps: [
    {
      name: 'api-convert',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      kill_timeout: 15_000,
      listen_timeout: 30_000,
      merge_logs: true,
      time: true,
      out_file: path.join(__dirname, 'logs', 'pm2-out.log'),
      error_file: path.join(__dirname, 'logs', 'pm2-error.log'),
      env: {
        NODE_ENV: 'development',
        PORT: 4004,
        CONCURRENCY: 3,
        NAVIGATION_TIMEOUT_MS: 30_000,
        WEBP_QUALITY: 80,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 4004,
        CONCURRENCY: 3,
        NAVIGATION_TIMEOUT_MS: 30_000,
        WEBP_QUALITY: 80,
      },
    },
  ],
};
