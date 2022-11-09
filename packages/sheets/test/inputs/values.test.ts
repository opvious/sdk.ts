import * as api from '@opvious/api-operations';

import {computeInputMapping} from '../../src/inputs/mapping';
import * as sut from '../../src/inputs/values';
import {InMemorySpreadsheet} from '../../src/spreadsheet';
import {identifyTables} from '../../src/table';
import {SHEET, tensorOutline} from '../helpers';

describe('extract input values', () => {
  test.each<[string, string, api.Outline, sut.InputValues]>([
    [
      'slim params',
      `
        d1, p1, p2, v1,  , d2, p3
        a,   1,  3,  5,  , 10,  a
        b,   2,  4,   ,  , 20,  b
        c,   8,  9
      `,
      {
        dimensions: [
          {label: 'd1', isNumeric: false},
          {label: 'd2', isNumeric: true},
        ],
        parameters: [
          tensorOutline('p1', [{dimensionLabel: 'd1'}]),
          tensorOutline('p2', [{dimensionLabel: 'd1'}]),
          tensorOutline(
            'p3',
            [{dimensionLabel: 'd1'}, {dimensionLabel: 'd2'}],
            true
          ),
        ],
        variables: [tensorOutline('v1', [{dimensionLabel: 'd1'}])],
        constraints: [],
      },
      {
        dimensions: [
          {label: 'd1', items: ['a', 'b', 'c']},
          {label: 'd2', items: [10, 20]},
        ],
        parameters: [
          {
            label: 'p1',
            entries: [
              {key: ['a'], value: 1},
              {key: ['b'], value: 2},
              {key: ['c'], value: 8},
            ],
          },
          {
            label: 'p2',
            entries: [
              {key: ['a'], value: 3},
              {key: ['b'], value: 4},
              {key: ['c'], value: 9},
            ],
          },
          {
            label: 'p3',
            entries: [
              {key: ['a', 10], value: 1},
              {key: ['b', 20], value: 1},
            ],
          },
        ],
        pinnedVariables: [
          {
            label: 'v1',
            entries: [{key: ['a'], value: 5}],
          },
        ],
      },
    ],
    [
      'wide param',
      `
          , p/q
        d1,   A, B, C, D
         a,   1, 3, 5
         b,   2,
         c,   8, 0,  , 6
      `,
      {
        dimensions: [
          {label: 'd1', isNumeric: false},
          {label: 'd2', isNumeric: false},
        ],
        parameters: [
          tensorOutline('p', [
            {dimensionLabel: 'd1'},
            {dimensionLabel: 'd2', qualifier: 'q'},
          ]),
        ],
        variables: [],
        constraints: [],
      },
      {
        dimensions: [
          {label: 'd1', items: ['a', 'b', 'c']},
          {label: 'd2', items: ['A', 'B', 'C', 'D']},
        ],
        parameters: [
          {
            label: 'p',
            entries: [
              {key: ['a', 'A'], value: 1},
              {key: ['a', 'B'], value: 3},
              {key: ['a', 'C'], value: 5},
              {key: ['b', 'A'], value: 2},
              {key: ['c', 'A'], value: 8},
              {key: ['c', 'D'], value: 6},
            ],
          },
        ],
        pinnedVariables: [],
      },
    ],
    [
      'wide 1D param',
      `
        p/d
          A, B, C, D
          1, 3, 5
      `,
      {
        dimensions: [{label: 'd', isNumeric: false}],
        parameters: [tensorOutline('p', [{dimensionLabel: 'd'}])],
        variables: [],
        constraints: [],
      },
      {
        dimensions: [{label: 'd', items: ['A', 'B', 'C', 'D']}],
        parameters: [
          {
            label: 'p',
            entries: [
              {key: ['A'], value: 1},
              {key: ['B'], value: 3},
              {key: ['C'], value: 5},
            ],
          },
        ],
        pinnedVariables: [],
      },
    ],
    [
      'wide 1D projected param',
      `
        p/q
          A, B, C, D
          1, 3, 5
      `,
      {
        dimensions: [
          {label: 'd1', isNumeric: true},
          {label: 'd2', isNumeric: false},
        ],
        parameters: [
          tensorOutline(
            'p',
            [{dimensionLabel: 'd1'}, {dimensionLabel: 'd2', qualifier: 'q'}],
            true
          ),
        ],
        variables: [],
        constraints: [],
      },
      {
        dimensions: [
          {label: 'd1', items: [1, 3, 5]},
          {label: 'd2', items: ['A', 'B', 'C', 'D']},
        ],
        parameters: [
          {
            label: 'p',
            entries: [
              {key: [1, 'A'], value: 1},
              {key: [3, 'B'], value: 1},
              {key: [5, 'C'], value: 1},
            ],
          },
        ],
        pinnedVariables: [],
      },
    ],
    [
      'wide projected param',
      `
         , p/c
        r,   0, 1, 2
        0,   1
        1,    , 4
        2,   3,  , 5
      `,
      {
        dimensions: [],
        parameters: [
          tensorOutline(
            'p',
            [{qualifier: 'r'}, {qualifier: 'c'}, {qualifier: 'x'}],
            true
          ),
        ],
        variables: [],
        constraints: [],
      },
      {
        dimensions: [],
        parameters: [
          {
            label: 'p',
            entries: [
              {key: [0, 0, 1], value: 1},
              {key: [1, 1, 4], value: 1},
              {key: [2, 0, 3], value: 1},
              {key: [2, 2, 5], value: 1},
            ],
          },
        ],
        pinnedVariables: [],
      },
    ],
  ])('handles %s case', (_desc, csv, sig, want) => {
    const ss = InMemorySpreadsheet.forCsvs({[SHEET]: csv});
    const tables = identifyTables(ss);
    const mapping = computeInputMapping(tables, sig);
    const got = sut.extractInputValues(mapping, ss);
    expect(got).toEqual(want);
  });
});
