import { loadEnvFile } from 'node:process';
import { configFromEnv } from './core/config.js';
import { createApp } from './app.js';
try {
  loadEnvFile('.env');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const config = configFromEnv();
const { app, tick, discord } = createApp(config);
const server = app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () =>
  console.log(`Open AIPA ready at ${config.url}`),
);
discord.start();
const timer = setInterval(() => {
  void tick().catch(() => console.error('Scheduler tick failed'));
}, 30000);
const shutdown = () => {
  clearInterval(timer);
  void discord.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
