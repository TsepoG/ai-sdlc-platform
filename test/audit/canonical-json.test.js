// @ts-check
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/audit/index.js';
import { ValidationError } from '../../src/errors/index.js';

describe('canonicalJson', () => {
  it('sorts object keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('gives the same text whatever the key order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it('drops undefined properties but keeps null', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('serialises primitives like JSON', () => {
    expect(canonicalJson(['é', true, false, 0, -1.5, null])).toBe('["é",true,false,0,-1.5,null]');
  });

  it('escapes strings like JSON', () => {
    expect(canonicalJson('quote " and \n newline')).toBe(JSON.stringify('quote " and \n newline'));
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a date', new Date(0)],
    ['a function', () => 1],
    ['a bigint', 1n],
    ['undefined at the top level', undefined],
    ['an undefined array element', [undefined]],
  ])('refuses %s', (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(ValidationError);
  });
});
