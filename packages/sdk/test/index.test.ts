import {readFile} from 'fs/promises';
import fetch from 'node-fetch';
import path from 'path';

import * as sut from '../src';

jest.setTimeout(30_000);

const AUTHORIZATION = process.env.OPVIOUS_AUTHORIZATION;

(AUTHORIZATION ? describe : describe.skip)('client', () => {
  let client: sut.OpviousClient;

  beforeAll(() => {
    client = sut.OpviousClient.create({authorization: AUTHORIZATION});
  });

  test('register and deletes specification', async () => {
    const formulationName = 'n-queens' + SUFFIX;
    await registerSpecification(client, formulationName, 'n-queens.md');
    await client.deleteFormulation(formulationName);
  });

  test('generates, lists, and revokes authorizations', async () => {
    const name = 'test-token';
    await client.revokeAuthorization(name);
    const token = await client.generateAccessToken({name, ttlDays: 1});
    const tokenClient = sut.OpviousClient.create({authorization: token});
    const infos1 = await tokenClient.listAuthorizations();
    expect(infos1.find((i) => i.name === name)).toBeDefined();
    const revoked = await tokenClient.revokeAuthorization(name);
    expect(revoked).toBe(true);
    const infos2 = await client.listAuthorizations();
    expect(infos2.find((i) => i.name === name)).toBeUndefined();
  });

  test('paginates formulations', async () => {
    const formulationName = 'n-queens' + SUFFIX;
    await registerSpecification(client, formulationName, 'n-queens.md');
    const infos1 = await client.paginateFormulations({
      first: 10,
      filter: {displayNameLike: formulationName},
    });
    expect(infos1).toMatchObject({values: [{name: formulationName}]});
    await client.deleteFormulation(formulationName);
    const infos2 = await client.paginateFormulations({first: 5});
    expect(
      infos2.values.find((f) => f.name === formulationName)
    ).toBeUndefined();
  });

  test('shares a formulation', async () => {
    const formulationName = 'n-queens' + SUFFIX;
    await client.deleteFormulation(formulationName);
    await registerSpecification(client, formulationName, 'n-queens.md');
    const {apiUrl} = await client.shareFormulation({
      name: formulationName,
      tagName: 'latest',
    });
    const res1 = await fetch('' + apiUrl);
    expect(res1.status).toEqual(200);
    await client.unshareFormulation({name: formulationName});
    const res2 = await fetch('' + apiUrl);
    expect(res2.status).toEqual(404);
  });

  test('paginates attempts', async () => {
    await client.paginateAttempts({first: 10});
    // TODO: Check things...
  });

  test('runs n-queens', async () => {
    const formulationName = 'n-queens' + SUFFIX;
    await registerSpecification(client, formulationName, 'n-queens.md');

    const {uuid} = await client.startAttempt({
      formulationName,
      parameters: [{label: 'size', entries: [{key: [], value: 5}]}],
    });

    const outcome = await client.waitForOutcome(uuid);
    expect(outcome).toMatchObject({isOptimal: true});

    const fetched = await client.fetchAttempt(uuid);
    expect(fetched).toMatchObject({
      outline: {
        parameters: [{label: 'size', isIntegral: true}],
      },
    });

    const inputs = await client.fetchAttemptInputs(uuid);
    expect(inputs).toEqual({
      dimensions: [],
      parameters: [
        {
          label: 'size',
          defaultValue: 0,
          entries: [{key: [], value: 5}],
        },
      ],
    });
  });

  test('runs set-cover', async () => {
    const formulationName = 'set-cover' + SUFFIX;
    await registerSpecification(client, formulationName, 'set-cover.md');
    const {uuid} = await client.startAttempt({
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
    const outcome = await client.waitForOutcome(uuid);
    expect(outcome).toMatchObject({isOptimal: true, objectiveValue: 2});
  });

  test('runs relaxed sudoku', async () => {
    const formulationName = 'sudoku' + SUFFIX;
    await registerSpecification(client, formulationName, 'sudoku.md');
    const {uuid} = await client.startAttempt({
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
    const outcome = await client.waitForOutcome(uuid);
    expect(outcome).toMatchObject({isOptimal: true});
    const outputs = await client.fetchAttemptOutputs(uuid);
    expect(outputs).toMatchObject({
      variables: [
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

async function registerSpecification(
  client: sut.OpviousClient,
  name: string,
  path: string
): Promise<void> {
  const src = await readSource(path);
  const defs = await client.extractDefinitions(src);
  await client.registerSpecification({
    formulationName: name,
    definitions: defs,
  });
}
