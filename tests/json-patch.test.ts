import { describe, expect, it } from 'vitest';
import { readJsonPointer, toJsonPointer } from '../src/core/diagnostics/jsonPatch';

describe('JSON pointers', () => {
  it('round-trips escaped and empty keys, and reads exact array indexes', () => {
    const pointer = toJsonPointer(['a/b', '~1', '', 0]);
    expect(pointer).toBe('/a~1b/~01//0');
    expect(readJsonPointer({ 'a/b': { '~1': { '': [null] } } }, pointer)).toEqual({ found: true, value: null });
    expect(readJsonPointer([1], '/1')).toEqual({ found: false });
    for (const path of ['/01', '/-1', '/1.0', '/-', '/length']) expect(() => readJsonPointer([1], path)).toThrow();
  });

  it('distinguishes missing from null and ignores inherited properties', () => {
    expect(readJsonPointer({ a: null }, '/a')).toEqual({ found: true, value: null });
    expect(readJsonPointer({}, '/a')).toEqual({ found: false });
    expect(readJsonPointer(Object.create({ a: 1 }), '/a')).toEqual({ found: false });
  });

  it('rejects malformed pointers', () => {
    for (const pointer of ['a', '#/a', '/a~', '/a~2']) {
      expect(() => readJsonPointer({}, pointer)).toThrow();
    }
  });
});
