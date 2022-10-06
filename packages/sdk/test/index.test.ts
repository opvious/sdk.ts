import {readFile} from 'fs/promises';
import path from 'path';

import * as sut from '../src';

jest.setTimeout(30_000);

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
    const attempt = await client.runAttempt({
      formulationName,
      parameters: [{label: 'size', entries: [{key: [], value: 5}]}],
    });
    expect(attempt).toMatchObject({
      outcome: {
        __typename: 'FeasibleOutcome',
        isOptimal: true,
      },
    });
  });

  test('runs set-cover', async () => {
    const source = await readSource('set-cover.md');
    const formulationName = 'set-cover' + SUFFIX;
    await client.registerSpecification({formulationName, source});
    const attempt = await client.runAttempt({
      formulationName,
      dimensions: [
        {label: 'sets', items: ['s1', 's2']},
        {label: 'vertices', items: ['v1', 'v2', 'v3']},
      ],
      parameters: [
        {
          label: 'coverage',
          entries: [
            {key: ['s1', 'v1']},
            {key: ['s1', 'v2']},
            {key: ['s2', 'v2']},
            {key: ['s2', 'v3']},
          ],
        },
      ],
    });
    expect(attempt).toMatchObject({
      outcome: {
        __typename: 'FeasibleOutcome',
        isOptimal: true,
        objectiveValue: 2,
      },
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
    const attempt = await client.runAttempt({
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
    expect(attempt).toMatchObject({
      outcome: {
        __typename: 'FeasibleOutcome',
        isOptimal: true,
      },
    });
    const outputs = await client.fetchAttemptOutputs(attempt.uuid);
    expect(outputs).toMatchObject({
      variableResults: [
        {
          label: 'matchHint_deficit',
          entries: [
            {key: [1, 0, 3], value: -1}, // Same key as above.
          ],
          origin: {
            __typename: 'DeficitVariable',
            deficitFor: 'matchHint',
          },
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
