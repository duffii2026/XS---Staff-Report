const root = __dirname;

function backendApp(n) {
  return {
    name: `stf_reportb${n}`,
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
  apps: [backendApp(1), backendApp(2), backendApp(3)]
};
