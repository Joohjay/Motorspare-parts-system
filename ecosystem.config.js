module.exports = {
  apps: [
    {
      name: 'jm-spareparts-api',
      script: 'dist/index.js',
      cwd: './server',
      node_args: '--import tsx',
      env: {
        NODE_ENV: 'production',
      },
      // Production overrides (set via pm2 ecosystem --env production)
      // or by using: pm2 start ecosystem.config.js --env production
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      // Graceful shutdown
      kill_timeout: 10_000,
      listen_timeout: 5_000,
      // Logging
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
