const root = __dirname;

function frontendApp() {
  return {
    name: 'apa2-staff-report',
    cwd: root,
    script: 'dist/server.cjs',
    instances: 1,
    exec_mode: 'fork',
    watch: [dist],
    watch_delay: 1000,
    ignore_watch: ['node_modules', 'logs', '*.log', '.env*'],
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      ENV_FILE: '.env2'
    }
  };
}

module.exports = {
  apps: [frontendApp()]
};
