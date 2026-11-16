const root = __dirname;

function frontendApp(n, dist) {
  return {
    name: `stf_report_${n}`,
    cwd: root,
    script: `${dist}/server.cjs`,
    instances: 1,
    exec_mode: 'fork',
    watch: [dist],
    watch_delay: 1000,
    ignore_watch: ['node_modules', 'logs', '*.log', '.env*'],
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      ENV_FILE: `.env${n}`
    }
  };
}

module.exports = {
  apps: [frontendApp(1, 'dist'), frontendApp(2, 'dist2'), frontendApp(3, 'dist3')]
};
