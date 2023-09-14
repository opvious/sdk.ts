import {Schema} from '@opvious/api/sdk';

import * as sut from '../../src/inputs/mapping.js';
import {extractTables, SHEET, tensorOutline} from '../helpers.js';

describe('computes mapping', () => {
  test.each<[string, string, Schema<'Outline'>, sut.InputMapping]>([
    [
      'slim parameters',
      `
        d1, p1, p2, v1,  , d2, p3
        a,   1,  2,  3,  ,  4,  5
      `,
      {
        dimensions: [
          {label: 'd1', isNumeric: false},
          {label: 'd2', isNumeric: true},
        ],
        parameters: [
          tensorOutline('p1', [{dimensionLabel: 'd1'}]),
          tensorOutline('p2', [{dimensionLabel: 'd1'}]),
          tensorOutline('p3', [{dimensionLabel: 'd2'}], true),
        ],
        variables: [tensorOutline('v1', [{dimensionLabel: 'd1'}])],
        constraints: [],
        objectives: [],
      },
      {
        dimensions: [
          {
            label: 'd1',
            isNumeric: false,
            itemRanges: [{sheet: SHEET, top: 2, left: 1, right: 1}],
          },
          {
            label: 'd2',
            isNumeric: true,
            itemRanges: [{sheet: SHEET, top: 2, left: 6, right: 6}],
          },
        ],
        parameters: [
          {
            label: 'p1',
            keyBoxes: [
              {
                kind: 'column',
                range: {sheet: SHEET, top: 2, left: 1, right: 1},
              },
            ],
            valueRange: {sheet: SHEET, top: 2, left: 2, right: 2},
          },
          {
            label: 'p2',
            keyBoxes: [
              {
                kind: 'column',
                range: {sheet: SHEET, top: 2, left: 1, right: 1},
              },
            ],
            valueRange: {sheet: SHEET, top: 2, left: 3, right: 3},
          },
          {
            label: 'p3',
            keyBoxes: [
              {
                kind: 'column',
                range: {sheet: SHEET, top: 2, left: 6, right: 6},
              },
            ],
            valueRange: {sheet: SHEET, top: 2, left: 7, right: 7},
          },
        ],
        variables: [
          {
            label: 'v1',
            keyBoxes: [
              {
                kind: 'column',
                range: {sheet: SHEET, top: 2, left: 1, right: 1},
              },
            ],
            valueRange: {sheet: SHEET, top: 2, left: 4, right: 4},
          },
        ],
      },
    ],
    [
      'wide tensors',
      `
          ,   , p2/q,  ,  , v/q
        d1, p1,    A, B, C,   A, B, D
        0 ,  1,    2  3, 4,   5, 6, 7
      `,
      {
        dimensions: [
          {label: 'd1', isNumeric: true},
          {label: 'd2', isNumeric: false},
        ],
        parameters: [
          tensorOutline('p1', [{dimensionLabel: 'd1'}]),
          tensorOutline('p2', [
            {dimensionLabel: 'd1'},
            {dimensionLabel: 'd2', qualifier: 'q'},
          ]),
        ],
        variables: [
          tensorOutline('v', [
            {dimensionLabel: 'd1'},
            {dimensionLabel: 'd2', qualifier: 'q'},
          ]),
        ],
        constraints: [],
        objectives: [],
      },
      {
        dimensions: [
          {
            label: 'd1',
            isNumeric: true,
            itemRanges: [{sheet: SHEET, top: 3, left: 1, right: 1}],
          },
          {
            label: 'd2',
            isNumeric: false,
            itemRanges: [{sheet: SHEET, top: 2, bottom: 2, left: 3, right: 5}],
          },
        ],
        parameters: [
          {
            label: 'p1',
            keyBoxes: [
              {
                kind: 'column',
                range: {sheet: SHEET, top: 3, left: 1, right: 1},
              },
            ],
            valueRange: {sheet: SHEET, top: 3, left: 2, right: 2},
          },
          {
            label: 'p2',
            keyBoxes: [
              {
                kind: 'column',
                range: {sheet: SHEET, top: 3, left: 1, right: 1},
              },
              {
                kind: 'row',
                range: {sheet: SHEET, top: 2, bottom: 2, left: 3, right: 5},
              },
            ],
            valueRange: {sheet: SHEET, top: 3, left: 3, right: 5},
          },
        ],
        variables: [
          {
            label: 'v',
            keyBoxes: [
              {
                kind: 'column',
                range: {sheet: SHEET, top: 3, left: 1, right: 1},
              },
              {
                kind: 'row',
                range: {sheet: SHEET, top: 2, bottom: 2, left: 6, right: 8},
              },
            ],
            valueRange: {sheet: SHEET, top: 3, left: 6, right: 8},
          },
        ],
      },
    ],
    [
      'indicator variable ranges',
      `
          , v/c
        r,    0, 1, 2
        0 ,   1, 2, 3
      `,
      {
        dimensions: [],
        parameters: [],
        variables: [
          tensorOutline(
            'v',
            [{qualifier: 'r'}, {qualifier: 'c'}, {qualifier: 'p'}],
            true
          ),
        ],
        constraints: [],
        objectives: [],
      },
      {
        dimensions: [],
        parameters: [],
        variables: [
          {
            label: 'v',
            keyBoxes: [
              {
                kind: 'column',
                range: {sheet: SHEET, top: 3, left: 1, right: 1},
              },
              {
                kind: 'row',
                range: {sheet: SHEET, top: 2, bottom: 2, left: 2, right: 4},
              },
              {
                kind: 'value',
                range: {sheet: SHEET, top: 3, left: 2, right: 4},
              },
            ],
          },
        ],
      },
    ],
    [
      'indicator parameter dimension',
      `
        p/d1
           0, 1, 2
           a, b, c
      `,
      {
        dimensions: [
          {label: 'd1', isNumeric: true},
          {label: 'd2', isNumeric: false},
        ],
        parameters: [
          tensorOutline(
            'p',
            [{dimensionLabel: 'd1'}, {dimensionLabel: 'd2'}],
            true
          ),
        ],
        variables: [],
        constraints: [],
        objectives: [],
      },
      {
        dimensions: [
          {
            label: 'd1',
            isNumeric: true,
            itemRanges: [{sheet: SHEET, top: 2, bottom: 2, left: 1, right: 3}],
          },
          {
            label: 'd2',
            isNumeric: false,
            itemRanges: [{sheet: SHEET, top: 3, left: 1, right: 3}],
          },
        ],
        parameters: [
          {
            label: 'p',
            keyBoxes: [
              {
                kind: 'row',
                range: {sheet: SHEET, top: 2, bottom: 2, left: 1, right: 3},
              },
              {
                kind: 'value',
                range: {sheet: SHEET, top: 3, left: 1, right: 3},
              },
            ],
          },
        ],
        variables: [],
      },
    ],
  ])('in %s case', (_desc, csv, sig, want) => {
    const tables = extractTables(csv);
    const got = sut.computeInputMapping(tables, sig);
    expect(got).toEqual(want);
  });
});
