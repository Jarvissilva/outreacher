module.exports = {
  apps: [
    {
      name: 'outreachit',
      cwd: `${__dirname}/apps/server`,
      script: 'dist/index.js',
      interpreter: 'node',
      node_args: '--env-file-if-exists=.env',
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      kill_timeout: 15000,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 6004,
      },
    },
  ],
};
