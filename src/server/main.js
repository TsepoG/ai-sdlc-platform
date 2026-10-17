// @ts-check
import { loadConfig } from '../config/index.js';
import { createLogger } from '../logger/index.js';
import { buildServer } from './index.js';

const LISTEN_HOST = '0.0.0.0';

const config = loadConfig();
const logger = createLogger({
  level: config.logLevel,
  version: config.appVersion,
  env: config.platformEnv,
});
const app = buildServer({ config, logger });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down');
    // Let the event loop drain after close so logs flush; exitCode marks a failed shutdown.
    app.close().catch((error) => {
      logger.error({ err: error }, 'shutdown failed');
      process.exitCode = 1;
    });
  });
}

await app.listen({ port: config.port, host: LISTEN_HOST });
