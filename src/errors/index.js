// @ts-check
export { AppError, ConfigError } from './app-error.js';
export {
  InvalidPackageError,
  InvalidTransitionError,
  NotAuthorisedError,
  RoutingError,
  SeparationOfDutiesError,
  StageConfigError,
  StalePackageError,
} from './domain-errors.js';
/** @typedef {import('./domain-errors.js').StageConfigIssue} StageConfigIssue */
