const root = __dirname;

function backendApp() {
  return {
    name: 'apa2-staff-report-api',
    cwd: root,
    script: 'dist/index.mjs',
    instances: 1,
    exec_mode: 'fork',
    watch: ['dist'],
    watch_delay: 1000,
    ignore_watch: ['node_modules', 'logs', '*.log', '.env*'],
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production'
    }
  };
}

module.exports = {
  apps: [backendApp()]
};
