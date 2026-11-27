// @ts-check

/**
 * The `log` job handler: writes the payload to the log. Phase 02's only handler; it proves the
 * outbox loop end to end. Logging is naturally idempotent.
 * @param {{ info: (...args: unknown[]) => void }} logger Logger.
 * @returns {import('./worker.js').JobHandler} The handler.
 */
export function createLogHandler(logger) {
  return async (payload, { jobId }) => {
    logger.info({ job: jobId, payload }, 'log job');
  };
}
