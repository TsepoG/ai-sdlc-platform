// @ts-check
import { describe, expect, it } from 'vitest';
import { StageConfigError } from '../../src/errors/index.js';
import { evaluateCondition } from '../../src/workflow/index.js';

describe('evaluateCondition', () => {
  it('is true when there is no condition', () => {
    expect(evaluateCondition(undefined, { flags: {} })).toBe(true);
  });

  it('is true when the named flag is true', () => {
    expect(
      evaluateCondition('initiative.flags.requiresTdf', { flags: { requiresTdf: true } }),
    ).toBe(true);
  });

  it('is false when the named flag is false', () => {
    expect(
      evaluateCondition('initiative.flags.requiresTdf', { flags: { requiresTdf: false } }),
    ).toBe(false);
  });

  it('is false when the named flag is absent', () => {
    expect(evaluateCondition('initiative.flags.requiresTdf', { flags: {} })).toBe(false);
  });

  it('does not read inherited properties as flags', () => {
    expect(evaluateCondition('initiative.flags.constructor', { flags: {} })).toBe(false);
  });

  it('throws StageConfigError for a condition that skipped load-time validation', () => {
    expect(() => evaluateCondition('initiative.flags.a || true', { flags: {} })).toThrow(
      StageConfigError,
    );
  });
});
