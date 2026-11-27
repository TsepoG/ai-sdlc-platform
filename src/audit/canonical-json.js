// @ts-check
import { ValidationError } from '../errors/index.js';

/**
 * Serialise plain data so equal data always gives identical text: object keys sorted at every
 * level, no whitespace, `undefined` properties dropped, primitives exactly as JSON.stringify.
 * Hashes are computed over this text, so it must never depend on key order.
 * @param {unknown} value Plain data: null, booleans, finite numbers, strings, arrays, objects.
 * @returns {string} Canonical JSON.
 * @throws {ValidationError} For values JSON cannot represent faithfully (NaN, Infinity, dates,
 *   functions, bigints, undefined outside an object).
 */
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return canonicalNumber(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    return canonicalObject(value);
  }
  throw new ValidationError(`Cannot canonicalise a value of type ${describe(value)}`);
}

/**
 * Serialise a finite number.
 * @param {number} value Number.
 * @returns {string} JSON text.
 * @throws {ValidationError} For NaN or an infinity.
 */
function canonicalNumber(value) {
  if (!Number.isFinite(value)) {
    throw new ValidationError('Cannot canonicalise a non-finite number');
  }
  return JSON.stringify(value);
}

/**
 * Serialise an object with sorted keys, skipping undefined values.
 * @param {Record<string, unknown>} value Plain object.
 * @returns {string} JSON text.
 */
function canonicalObject(value) {
  const members = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort((a, b) => (a < b ? -1 : 1))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${members.join(',')}}`;
}

/**
 * Check for a plain object (not a Date, Map, class instance, …).
 * @param {unknown} value Value.
 * @returns {value is Record<string, unknown>} True for `{}`-style objects.
 */
function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Name a value's type for an error message.
 * @param {unknown} value Value.
 * @returns {string} Type name.
 */
function describe(value) {
  return typeof value === 'object' ? Object.prototype.toString.call(value) : typeof value;
}
