// @ts-check
import { loadConfig } from '../config/index.js';
import { StageConfigError } from '../errors/index.js';
import { createLogger } from '../logger/index.js';
import { createApp } from './index.js';

const LISTEN_HOST = '0.0.0.0';

const config = loadConfig();
const logger = createLogger({
  level: config.logLevel,
  version: config.appVersion,
  env: config.platformEnv,
});

/**
 * Build the app and listen; on a startup failure, log it and exit non-zero without listening.
 * @returns {Promise<void>} Resolves once listening, or after a failed startup is recorded.
 */
async function start() {
  /** @type {import('./index.js').AppServer} */
  let app;
  try {
    app = await createApp({ config, logger });
  } catch (error) {
    // createApp has already logged stage-config details; log anything else here.
    if (!(error instanceof StageConfigError)) {
      logger.fatal({ err: error }, 'startup failed');
    }
    process.exitCode = 1;
    return;
  }

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
}

await start();
