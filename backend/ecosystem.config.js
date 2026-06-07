/**
 * PM2 Ecosystem — Deal Hunter AI
 *
 * Start all services:   pm2 start ecosystem.config.js
 * Start one service:    pm2 start ecosystem.config.js --only discovery
 * Logs:                 pm2 logs
 * Monitor:              pm2 monit
 * Save process list:    pm2 save
 * Auto-start on reboot: pm2 startup
 */

module.exports = {
  apps: [
    // ── API Server ────────────────────────────────────────────────────────────
    {
      name: 'dealhunter',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/api-error.log',
      out_file:   'logs/api-out.log',
      merge_logs: true,
    },

    // ── Discovery Loop ────────────────────────────────────────────────────────
    {
      name: 'dealhunter-live',
      script: 'run-discovery-live.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      // Restart if Chromium leaks past 2 GB
      max_memory_restart: '2G',
      // Back off on repeated crashes: 10s → 20s → 40s → ... → 5 min max
      restart_delay: 10000,
      exp_backoff_restart_delay: 100,
      max_restarts: 20,
      min_uptime: '60s',
      env: {
        NODE_ENV: 'production',
        // Parallel product scans per discovery batch
        SCAN_CONCURRENCY: '3',
        // Restart browser pool every 5 cycles (~2.5 hours)
        POOL_RESTART_CYCLES: '5',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/discovery-error.log',
      out_file:   'logs/discovery-out.log',
      merge_logs: true,
    },
  ],
};
