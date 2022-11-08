import * as sut from '../src/common';

describe('if present', () => {
  test('present', () => {
    expect(sut.ifPresent(1, (v) => v + 1)).toBe(2);
  });

  test('null', () => {
    expect(sut.ifPresent(null, () => 3)).toBe(undefined);
  });

  test('undefined', () => {
    expect(sut.ifPresent(undefined, (v) => v + 4)).toBe(undefined);
  });
});
