// @ts-check
import { randomUUID } from 'node:crypto';

/** Header carrying the request ID in and out. */
export const REQUEST_ID_HEADER = 'x-request-id';
/** Field name under which the request ID appears in log lines. */
export const REQUEST_ID_LOG_LABEL = 'requestId';

/** Only accept caller-supplied IDs that are short and log-safe. */
const SAFE_REQUEST_ID = /^[\w.-]{1,128}$/;

/**
 * Pick the request ID: a safe caller-supplied `x-request-id`, otherwise a fresh UUID.
 * @param {import('node:http').IncomingMessage} request Incoming request.
 * @returns {string} Request ID for logs and the response header.
 */
export function generateRequestId(request) {
  const supplied = request.headers[REQUEST_ID_HEADER];
  return typeof supplied === 'string' && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
}
