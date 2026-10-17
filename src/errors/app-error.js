// @ts-check

const DEFAULT_STATUS_CODE = 500;
const DEFAULT_ERROR_CODE = 'INTERNAL_ERROR';
const CONFIG_ERROR_CODE = 'CONFIG_INVALID';

/**
 * @typedef {object} AppErrorOptions
 * @property {number} [statusCode] HTTP status to report (default 500).
 * @property {string} [code] Stable machine-readable error code.
 * @property {unknown} [cause] Underlying error being wrapped.
 */

/** Base class for errors the platform raises on purpose; the server maps these to responses. */
export class AppError extends Error {
  /**
   * Create an application error.
   * @param {string} message Human-readable message; safe to show to API clients.
   * @param {AppErrorOptions} [options] Status, code and cause.
   */
  constructor(
    message,
    { statusCode = DEFAULT_STATUS_CODE, code = DEFAULT_ERROR_CODE, cause } = {},
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    /** @type {number} */
    this.statusCode = statusCode;
    /** @type {string} */
    this.code = code;
  }
}

/** The process environment is missing or invalid; the service cannot start. */
export class ConfigError extends AppError {
  /**
   * Create a configuration error.
   * @param {string} message Description of what is wrong (never include secret values).
   * @param {{ cause?: unknown }} [options] Underlying error being wrapped.
   */
  constructor(message, { cause } = {}) {
    super(message, { statusCode: DEFAULT_STATUS_CODE, code: CONFIG_ERROR_CODE, cause });
  }
}
