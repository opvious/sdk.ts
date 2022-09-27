import {readFile} from 'fs/promises';
import path from 'path';

import * as sut from '../src';

jest.setTimeout(15_000);

const ACCESS_TOKEN = process.env.OPVIOUS_TOKEN;

(ACCESS_TOKEN ? describe : describe.skip)('client', () => {
  let client: sut.OpviousClient;

  beforeAll(() => {
    client = sut.OpviousClient.create();
  });

  test('register and deletes specification', async () => {
    const source = await readSource('n-queens.md');
    const formulationName = 'n-queens' + SUFFIX;
    await client.registerSpecification({formulationName, source});
    await client.deleteFormulation(formulationName);
  });

  test('runs n-queens', async () => {
    const source = await readSource('n-queens.md');
    const formulationName = 'n-queens' + SUFFIX;
    await client.registerSpecification({formulationName, source});
    const outcome = await client.runAttempt({
      formulationName,
      parameters: [{label: 'size', entries: [{key: [], value: 5}]}],
    });
    expect(outcome).toMatchObject({
      __typename: 'FeasibleOutcome',
      isOptimal: true,
    });
  });

  test('shares a formulation', async () => {
    const source = await readSource('n-queens.md');
    const formulationName = 'n-queens' + SUFFIX;
    await client.registerSpecification({formulationName, source});
    await client.shareFormulation({
      name: formulationName,
      tagName: 'latest',
    });
  });

  test('runs relaxed sudoku', async () => {
    const source = await readSource('sudoku.md');
    const formulationName = 'sudoku' + SUFFIX;
    await client.registerSpecification({formulationName, source});
    const outcome = await client.runAttempt({
      formulationName,
      parameters: [
        {
          label: 'hints',
          entries: [
            {key: [0, 0, 1]},
            {key: [0, 1, 2]},
            {key: [0, 2, 3]},
            {key: [1, 0, 3]}, // Conflicting hint.
            {key: [1, 3, 3]},
          ],
        },
      ],
      relaxation: {
        penalty: 'DEVIATION_CARDINALITY',
        constraints: [{label: 'matchHint', deficitBound: -1}],
      },
    });
    expect(outcome).toMatchObject({
      __typename: 'FeasibleOutcome',
      isOptimal: true,
      variableResults: [
        {
          label: 'matchHint_deficit',
          entries: [
            {key: [1, 0, 3], value: -1}, // Same key as above.
          ],
        },
        {label: 'positions'},
      ],
    });
  });
});

const SUFFIX = '-ts-sdk-test';

const DATA_DPATH = path.join(__dirname, 'data');

function readSource(fname: string): Promise<string> {
  return readFile(path.join(DATA_DPATH, fname), 'utf8');
}
