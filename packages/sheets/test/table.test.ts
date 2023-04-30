import {InMemorySpreadsheet} from '../src/spreadsheet/index.js';
import * as sut from '../src/table.js';

const h = sut.newHeader;
const SHEET = 's1';

describe('header', () => {
  test.each([
    [' foo  bar', 'foo bar'],
    ['hotPotatoes', 'hot potato'],
    ['matchHint_deficit', 'match hint (deficit)'],
    ['match hint (deficit)', 'match hint (deficit)'],
  ])('parses %s to %s', (arg, want) => {
    expect(sut.newHeader(arg)).toEqual(want);
  });
});

describe('identifies tables', () => {
  test.each<[string, string, ReadonlyArray<sut.Table>]>([
    [
      'slim blocks',
      `
        a, b, , c, ,
        0, 1, , 2
      `,
      [
        {
          blocks: new Map([
            [
              h('a'),
              {
                kind: 'slim',
                header: h('a'),
                bodyRange: {sheet: SHEET, top: 2, left: 1, right: 1},
              },
            ],
            [
              h('b'),
              {
                kind: 'slim',
                header: h('b'),
                bodyRange: {sheet: SHEET, top: 2, left: 2, right: 2},
              },
            ],
          ]),
        },
        {
          blocks: new Map([
            [
              h('c'),
              {
                kind: 'slim',
                header: h('c'),
                bodyRange: {sheet: SHEET, top: 2, left: 4, right: 4},
              },
            ],
          ]),
        },
      ],
    ],
    [
      'wide blocks',
      `
        h1, ,   , h3/q,   ,   , h4/q
         0, , h2,   k1, k2, k3,   k2, k3
      `,
      [
        {
          blocks: new Map([
            [
              h('h1'),
              {
                kind: 'slim',
                header: h('h1'),
                bodyRange: {sheet: SHEET, top: 2, left: 1, right: 1},
              },
            ],
          ]),
        },
        {
          blocks: new Map([
            [
              h('h2'),
              {
                kind: 'slim',
                header: h('h2'),
                bodyRange: {sheet: SHEET, top: 3, left: 3, right: 3},
              },
            ],
            [
              h('h3'),
              {
                kind: 'wide',
                header: h('h3'),
                nestedHeader: h('q'),
                headRange: {sheet: SHEET, top: 2, bottom: 2, left: 4, right: 6},
                bodyRange: {sheet: SHEET, top: 3, left: 4, right: 6},
              },
            ],
            [
              h('h4'),
              {
                kind: 'wide',
                header: h('h4'),
                nestedHeader: h('q'),
                headRange: {sheet: SHEET, top: 2, bottom: 2, left: 7, right: 8},
                bodyRange: {sheet: SHEET, top: 3, left: 7, right: 8},
              },
            ],
          ]),
        },
      ],
    ],
  ])('in %s case', (_desc, csv, want) => {
    const ss = InMemorySpreadsheet.forCsvs({[SHEET]: csv});
    const got = sut.identifyTables(ss);
    expect(got).toEqual(want);
  });
});
