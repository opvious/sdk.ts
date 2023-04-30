import {Schema} from '@opvious/api/sdk';

import {computeInputMapping} from '../src/inputs/index.js';
import * as sut from '../src/results.js';
import {InMemorySpreadsheet} from '../src/spreadsheet/index.js';
import {identifyTables} from '../src/table.js';
import {SHEET, tensorOutline} from './helpers.js';

describe('populates results', () => {
  test.each<
    [
      string,
      string,
      Schema<'Outline'>,
      ReadonlyArray<Schema<'TensorResult'>>,
      string
    ]
  >([
    [
      'slim results',
      `
        d1, p1, v1, p2,  , d2, v2
        a,   1,  5,  3,  , 10,  a
        b,   2,   ,   ,  , 20,  b
        c,   8,   ,  9
      `,
      {
        dimensions: [
          {label: 'd1', isNumeric: false},
          {label: 'd2', isNumeric: true},
        ],
        parameters: [
          tensorOutline('p1', [{dimensionLabel: 'd1'}]),
          tensorOutline('p2', [{dimensionLabel: 'd1'}]),
        ],
        variables: [
          tensorOutline('v1', [{dimensionLabel: 'd1'}]),
          tensorOutline('v2', [{dimensionLabel: 'd2'}], true),
        ],
        constraints: [],
        objectives: [],
      },
      [
        {
          label: 'v1',
          entries: [
            {key: ['a'], value: 11},
            {key: ['c'], value: 33},
            {key: ['d'], value: 44},
          ],
        },
        {label: 'v2', entries: []},
      ],
      `
       d1,  p1, v1, p2,  , d2, v2
        a,   1, 11,  3,  , 10,  0
        b,   2,  0,   ,  , 20,  0
        c,   8, 33,   9
        d,    , 44
      `,
    ],
    [
      'slim 1D results',
      `
        v1, p1
         5,  3
      `,
      {
        dimensions: [],
        parameters: [tensorOutline('p1', [])],
        variables: [tensorOutline('v1', [])],
        constraints: [],
        objectives: [],
      },
      [
        {
          label: 'v1',
          entries: [{key: [], value: 400}],
        },
      ],
      `
        v1, p1
       400,  3
      `,
    ],
    [
      'slim projected results',
      `
        d2, , d1, v1, p1
         C, ,  a,    ,  3
         A, ,  b
         B, ,  c,   C,  9
         D
      `,
      {
        dimensions: [
          {label: 'd1', isNumeric: false},
          {label: 'd2', isNumeric: false},
        ],
        parameters: [tensorOutline('p1', [{dimensionLabel: 'd1'}])],
        variables: [
          tensorOutline(
            'v1',
            [{dimensionLabel: 'd1'}, {dimensionLabel: 'd2'}],
            true
          ),
        ],
        constraints: [],
        objectives: [],
      },
      [
        {
          label: 'v1',
          entries: [
            {key: ['a', 'A'], value: 1},
            {key: ['b', 'B'], value: 1},
            {key: ['d', 'D'], value: 1},
          ],
        },
      ],
      `
        d2, , d1, v1, p1
         C, ,  a,  A,  3
         A, ,  b,  B
         B, ,  c,   ,  9
         D, ,  d,  D
      `,
    ],
    [
      'slim projected 1D result',
      `
        d1, , v1
         A
         B
      `,
      {
        dimensions: [{label: 'd1', isNumeric: false}],
        parameters: [],
        variables: [tensorOutline('v1', [{dimensionLabel: 'd1'}], true)],
        constraints: [],
        objectives: [],
      },
      [
        {
          label: 'v1',
          entries: [{key: ['A'], value: 1}],
        },
      ],
      `
        d1, , v1
         A, ,  A
         B
      `,
    ],
    [
      'wide unprojected results',
      `
           ,   , v/r
         d1, d2,   0, 1, 2, 3
         a,   A,    , 6,  , 7
         b,   A,   8, 9
         b,   B,
      `,
      {
        dimensions: [
          {label: 'd1', isNumeric: false},
          {label: 'd2', isNumeric: false},
        ],
        parameters: [],
        variables: [
          tensorOutline('v', [
            {qualifier: 'r'},
            {dimensionLabel: 'd2'},
            {dimensionLabel: 'd1'},
          ]),
        ],
        constraints: [],
        objectives: [],
      },
      [
        {
          label: 'v',
          entries: [
            {key: [1, 'A', 'a'], value: 10},
            {key: [2, 'A', 'a'], value: 11},
            {key: [3, 'A', 'a'], value: 12},
            {key: [3, 'B', 'b'], value: 30},
            {key: [2, 'B', 'a'], value: 20},
          ],
        },
      ],
      `
           ,   , v/r
         d1, d2,   0,  1,  2,  3
         a,   A,   0, 10, 11, 12
         b,   A,   0,  0,  0,  0
         b,   B,   0,  0,  0, 30
         a,   B,   0,  0, 20,  0
      `,
    ],
    [
      'wide projected results',
      `
          , v/c
         r,   0, 1, 2, 3
         0,   5, 6,  , 7
         1,    , 8, 9
         2,    ,  , 7
      `,
      {
        dimensions: [],
        parameters: [],
        variables: [
          tensorOutline(
            'v',
            [{qualifier: 'r'}, {qualifier: 'c'}, {qualifier: 'x'}],
            true
          ),
        ],
        constraints: [],
        objectives: [],
      },
      [
        {
          label: 'v',
          entries: [
            {key: [0, 0, 1], value: 1},
            {key: [1, 1, 2], value: 1},
            {key: [2, 2, 3], value: 1},
          ],
        },
      ],
      `
          , v/c
         r,   0, 1, 2, 3
         0,   1
         1,    , 2
         2,    ,  , 3
      `,
    ],
    [
      'wide appended projected results',
      `
          , v/a
         d,  a1, a2, a3, a4
      `,
      {
        dimensions: [],
        parameters: [],
        variables: [
          tensorOutline(
            'v',
            [{qualifier: 'd'}, {qualifier: 'a'}, {qualifier: 's'}],
            true
          ),
        ],
        constraints: [],
        objectives: [],
      },
      [
        {
          label: 'v',
          entries: [
            {key: [1, 'a1', 'A'], value: 1},
            {key: [1, 'a2', 'A'], value: 1},
            {key: [1, 'a4', 'B'], value: 1},
            {key: [2, 'a1', 'A'], value: 1},
            {key: [2, 'a2', 'A'], value: 1},
            {key: [2, 'a3', 'B'], value: 1},
          ],
        },
      ],
      `
          , v/a
         d,  a1, a2, a3, a4
         1,   A,  A,   ,  B
         2,   A,  A,  B
      `,
    ],
  ])('handles %s case', (_desc, csv, sig, results, after) => {
    const ss1 = InMemorySpreadsheet.forCsvs({[SHEET]: csv});
    const tables = identifyTables(ss1);
    const mapping = computeInputMapping(tables, sig);
    sut.populateResults(results, mapping, ss1);
    const ss2 = InMemorySpreadsheet.forCsvs({[SHEET]: after});
    const rg = {sheet: SHEET};
    expect(ss1.readColumns([rg])).toEqual(ss2.readColumns([rg]));
  });
});
