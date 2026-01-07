module.exports = {
  apps: [{
    name: 'safewebedits-api',
    script: './src/server.js',
    cwd: '/root/safewebedit/backend',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 5005
    },
    error_file: '/root/safewebedit/logs/api-error.log',
    out_file: '/root/safewebedit/logs/api-out.log',
    log_file: '/root/safewebedit/logs/api-combined.log',
    time: true
  }]
};
