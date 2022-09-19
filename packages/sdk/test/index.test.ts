import {readFile} from 'fs/promises';
import path from 'path';

import * as sut from '../src';

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
    expect(outcome).toEqual({__typename: 'FeasibleOutcome', isOptimal: true});
  });
});

const SUFFIX = '-ts-sdk-test';

const DATA_DPATH = path.join(__dirname, 'data');

function readSource(fname: string): Promise<string> {
  return readFile(path.join(DATA_DPATH, fname), 'utf8');
}
