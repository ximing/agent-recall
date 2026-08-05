import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { loadAppEnv } from './env.js';

loadAppEnv();

const config = loadConfig();
const app = await buildApp({ config, logger: true });
await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`agent-recall listening on ${config.HOST}:${String(config.PORT)}`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
