import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { loadAppEnv } from './env.js';
import { startMaintenanceSweep, sweepOnce, type SweepLog } from './maintenance/sweep.js';

loadAppEnv();

const config = loadConfig();
const app = await buildApp({ config, logger: true });
await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`agent-recall listening on ${config.HOST}:${String(config.PORT)}`);

const log: SweepLog = {
  info: (message) => app.log.info(message),
  error: (error, message) => app.log.error({ err: error }, message),
};
const maintenance = startMaintenanceSweep({
  log,
  run: () =>
    sweepOnce({
      db: app.ctx.db,
      pool: app.ctx.pool,
      retrieval: app.ctx.retrieval,
      encryptionKey: config.ENCRYPTION_KEY,
      appEnv: config.APP_ENV,
      schema: config.DATABASE_SCHEMA,
      log,
    }),
});

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  maintenance.stop();
  await maintenance.idle();
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
