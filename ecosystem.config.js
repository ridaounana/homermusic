// pm2 process definitions. Start both with:  pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'music-bot',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
