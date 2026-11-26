// @ts-check

/**
 * Freeze a plain-data value and everything reachable from it.
 * @template T
 * @param {T} value Plain data (objects, arrays, primitives).
 * @returns {Readonly<T>} The same value, frozen.
 */
export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
