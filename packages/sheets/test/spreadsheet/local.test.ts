import * as sut from '../../src/spreadsheet/local.js';

const SHEET = 's1';

describe('in-memory spreadsheet', () => {
  test('for columns', () => {
    const ss = sut.InMemorySpreadsheet.forColumns({
      s1: [['a', 'b'], ['c']],
      s2: [['d']],
    });
    expect(ss.readColumns([{sheet: 's1'}])).toEqual([[['a', 'b'], ['c']]]);
    expect(ss.readColumns([{sheet: 's2', left: 2}])).toEqual([[]]);
  });

  test('for CSVs', () => {
    const ss = sut.InMemorySpreadsheet.forCsvs({
      s1: `
        a, b, c
        1, 2
         , 3, 4
         ,
      `,
    });
    expect(ss.readColumns([{sheet: 's1'}])).toEqual([
      [
        ['a', 1],
        ['b', 2, 3],
        ['c', '', 4],
      ],
    ]);
  });

  test('trims when reading', () => {
    const ss = sut.InMemorySpreadsheet.forCsvs({
      s1: `
        a, b, c
         , 2
         , 3, 4
      `,
    });
    expect(ss.readColumns([{sheet: 's1', top: 2, bottom: 2}])).toEqual([
      [[], [2]],
    ]);
  });

  test('pads when reading', () => {
    const ss = sut.InMemorySpreadsheet.forCsvs({
      s1: `
        a, b, c
         , 2
         , 3, 4
      `,
    });
    expect(ss.readColumns([{sheet: 's1', top: 2, left: 2}])).toEqual([
      [
        [2, 3],
        ['', 4],
      ],
    ]);
  });

  test('updates all columns', () => {
    const ss = sut.InMemorySpreadsheet.forCsvs({s1: ''});
    ss.updateColumns([
      {range: {sheet: 's1'}, columns: [['a', 1], ['b', ''], ['']]},
    ]);
    expect(ss.readColumns([{sheet: 's1'}])).toEqual([[['a', 1], ['b']]]);
  });

  test('updates from offset', () => {
    const ss = sut.InMemorySpreadsheet.forCsvs({
      s1: `
        a, b, c
        1, 2, 3
        4, 5,
      `,
    });
    ss.updateColumns([
      {
        range: {sheet: 's1', top: 1, bottom: 2, left: 2},
        columns: [['B', 8, 9], [''], ['D']],
      },
    ]);
    expect(ss.readColumns([{sheet: 's1'}])).toEqual([
      [['a', 1, 4], ['B', 8, 5], [], ['D']],
    ]);
  });

  test.each([
    [
      `
         , p/c
        r,   0, 1, 2
        0,   1
        1,    , 4
        2,   3,  , 5
      `,
      {sheet: SHEET, top: 2, bottom: 2, left: 2, right: 4},
      [[0], [1], [2]],
    ],
  ])('parses %s', (csv, rg, want) => {
    const ss = sut.InMemorySpreadsheet.forCsvs({[SHEET]: csv});
    const [cols] = ss.readColumns([rg]);
    expect(cols).toEqual(want);
  });
});
