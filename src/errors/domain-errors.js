// @ts-check
import { AppError } from './app-error.js';

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
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

/**
 * An AppError whose status and code are fixed per subclass, declared as static fields, so each
 * error type is a two-line declaration rather than a repeated constructor.
 */
export class FixedAppError extends AppError {
  /** HTTP status this error maps to. */
  static statusCode = HTTP_SERVER_ERROR;
  /** Stable machine-readable code. */
  static code = 'INTERNAL_ERROR';

  /**
   * Create the error with its subclass's status and code.
   * @param {string} message Human-readable message; safe to show to API clients when status < 500.
   * @param {CauseOptions} [options] Underlying error being wrapped.
   */
  constructor(message, { cause } = {}) {
    const type = /** @type {typeof FixedAppError} */ (new.target);
    super(message, { statusCode: type.statusCode, code: type.code, cause });
  }
}

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
export class RoutingError extends FixedAppError {
  /** @override */
  static statusCode = HTTP_SERVER_ERROR;
  /** @override */
  static code = 'ROUTING_INVALID';
}

/** A step outcome does not lead anywhere under the stage's rules. */
export class InvalidTransitionError extends FixedAppError {
  /** @override */
  static statusCode = HTTP_CONFLICT;
  /** @override */
  static code = 'INVALID_TRANSITION';
}

/** A decision was made against a package hash that is no longer current. */
export class StalePackageError extends FixedAppError {
  /** @override */
  static statusCode = HTTP_CONFLICT;
  /** @override */
  static code = 'STALE_PACKAGE';
}

/** The reviewer does not hold the role a gate requires. */
export class NotAuthorisedError extends FixedAppError {
  /** @override */
  static statusCode = HTTP_FORBIDDEN;
  /** @override */
  static code = 'NOT_AUTHORISED';
}

/** The reviewer authored or edited a version in the package they are deciding. */
export class SeparationOfDutiesError extends FixedAppError {
  /** @override */
  static statusCode = HTTP_FORBIDDEN;
  /** @override */
  static code = 'SEPARATION_OF_DUTIES';
}

/** A review package cannot be built: it is empty, or holds a malformed hash or a foreign version. */
export class InvalidPackageError extends FixedAppError {
  /** @override */
  static statusCode = HTTP_BAD_REQUEST;
  /** @override */
  static code = 'PACKAGE_INVALID';
}

/** The requested record or content does not exist. */
export class NotFoundError extends FixedAppError {
  /** @override */
  static statusCode = HTTP_NOT_FOUND;
  /** @override */
  static code = 'NOT_FOUND';
}

/** Stored content no longer matches the hash it was stored under. */
export class ContentIntegrityError extends FixedAppError {
  /** @override */
  static statusCode = HTTP_SERVER_ERROR;
  /** @override */
  static code = 'CONTENT_CORRUPT';
}

/** A gate was decided concurrently, or is otherwise no longer open for a decision. */
export class GateNotOpenError extends FixedAppError {
  /** @override */
  static statusCode = HTTP_CONFLICT;
  /** @override */
  static code = 'GATE_NOT_OPEN';
}

/** A package cannot be submitted while blocking open questions are unanswered. */
export class BlockingQuestionsError extends FixedAppError {
  /** @override */
  static statusCode = HTTP_CONFLICT;
  /** @override */
  static code = 'BLOCKING_QUESTIONS_OPEN';
}

/** A request body or parameter failed validation. */
export class ValidationError extends FixedAppError {
  /** @override */
  static statusCode = HTTP_BAD_REQUEST;
  /** @override */
  static code = 'VALIDATION_FAILED';
}

/** A database migration could not be applied, or an applied one was changed afterwards. */
export class MigrationError extends FixedAppError {
  /** @override */
  static statusCode = HTTP_SERVER_ERROR;
  /** @override */
  static code = 'MIGRATION_FAILED';
}
