// @ts-check
import { AppError } from './app-error.js';

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_SERVER_ERROR = 500;

/**
 * @typedef {object} CauseOptions
 * @property {unknown} [cause] Underlying error being wrapped.
 */

/**
 * @typedef {object} StageConfigIssue
 * @property {string} source File (or other source) the problem is in.
 * @property {string} path Dotted path inside that source, or `(root)`.
 * @property {string} message What is wrong.
 */

/** Stage configuration is invalid; the service must not start with it. */
export class StageConfigError extends AppError {
  /**
   * Create a stage configuration error listing every problem found.
   * @param {StageConfigIssue[]} issues Problems found, each naming its file and path.
   * @param {CauseOptions} [options] Underlying error being wrapped.
   */
  constructor(issues, { cause } = {}) {
    const lines = issues.map((issue) => `${issue.source}: ${issue.path}: ${issue.message}`);
    super(`Invalid stage configuration: ${lines.join('; ')}`, {
      statusCode: HTTP_SERVER_ERROR,
      code: 'STAGE_CONFIG_INVALID',
      cause,
    });
    /** @type {ReadonlyArray<Readonly<StageConfigIssue>>} */
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
  }
}

/** AI routing configuration is invalid or no provider can serve a route. */
export class RoutingError extends AppError {
  /**
   * Create a routing error.
   * @param {string} message What is wrong with the routing.
   * @param {CauseOptions} [options] Underlying error being wrapped.
   */
  constructor(message, { cause } = {}) {
    super(message, { statusCode: HTTP_SERVER_ERROR, code: 'ROUTING_INVALID', cause });
  }
}

/** A step outcome does not lead anywhere under the stage's rules. */
export class InvalidTransitionError extends AppError {
  /**
   * Create an invalid-transition error.
   * @param {string} message Which transition was refused and why.
   * @param {CauseOptions} [options] Underlying error being wrapped.
   */
  constructor(message, { cause } = {}) {
    super(message, { statusCode: HTTP_CONFLICT, code: 'INVALID_TRANSITION', cause });
  }
}

/** A decision was made against a package hash that is no longer current. */
export class StalePackageError extends AppError {
  /**
   * Create a stale-package error.
   * @param {string} message Explanation for the reviewer.
   * @param {CauseOptions} [options] Underlying error being wrapped.
   */
  constructor(message, { cause } = {}) {
    super(message, { statusCode: HTTP_CONFLICT, code: 'STALE_PACKAGE', cause });
  }
}

/** The reviewer does not hold the role a gate requires. */
export class NotAuthorisedError extends AppError {
  /**
   * Create a not-authorised error.
   * @param {string} message Explanation for the reviewer.
   * @param {CauseOptions} [options] Underlying error being wrapped.
   */
  constructor(message, { cause } = {}) {
    super(message, { statusCode: HTTP_FORBIDDEN, code: 'NOT_AUTHORISED', cause });
  }
}

/** The reviewer authored or edited a version in the package they are deciding. */
export class SeparationOfDutiesError extends AppError {
  /**
   * Create a separation-of-duties error.
   * @param {string} message Explanation for the reviewer.
   * @param {CauseOptions} [options] Underlying error being wrapped.
   */
  constructor(message, { cause } = {}) {
    super(message, { statusCode: HTTP_FORBIDDEN, code: 'SEPARATION_OF_DUTIES', cause });
  }
}

/** A review package cannot be hashed: it is empty or holds a malformed content hash. */
export class InvalidPackageError extends AppError {
  /**
   * Create an invalid-package error.
   * @param {string} message What is wrong with the package.
   * @param {CauseOptions} [options] Underlying error being wrapped.
   */
  constructor(message, { cause } = {}) {
    super(message, { statusCode: HTTP_BAD_REQUEST, code: 'PACKAGE_INVALID', cause });
  }
}
