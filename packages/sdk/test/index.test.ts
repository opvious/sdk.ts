import {RecordingTelemetry} from '@opvious/stl-telemetry';
import {readFile} from 'fs/promises';
import path from 'path';

import * as sut from '../src';

const telemetry = RecordingTelemetry.forTesting();

const client = sut.OpviousClient.create({telemetry});

const ATTEMPT_TIMEOUT = 20_000;

(client.authenticated ? describe : describe.skip)('client', () => {
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
    expect(infos1).toMatchObject({nodes: [{name: formulationName}]});
    await client.deleteFormulation(formulationName);
    const infos2 = await client.paginateFormulations({first: 5});
    expect(
      infos2.nodes.find((f) => f.name === formulationName)
    ).toBeUndefined();
  });

  test('paginates attempts', async () => {
    await client.paginateAttempts({first: 10});
    // TODO: Check things...
  });

  test(
    'runs n-queens attempt',
    async () => {
      const formulationName = 'n-queens' + SUFFIX;
      await registerSpecification(client, formulationName, 'n-queens.md');

      const {uuid} = await client.startAttempt({
        formulationName,
        inputs: {parameters: [{label: 'size', entries: [{key: [], value: 5}]}]},
      });

      const outcome = await client.waitForFeasibleOutcome(uuid);
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
        pinnedVariables: [],
      });
    },
    ATTEMPT_TIMEOUT
  );

  test(
    'runs set-cover attempt',
    async () => {
      const formulationName = 'set-cover' + SUFFIX;
      await registerSpecification(client, formulationName, 'set-cover.md');
      const {uuid} = await client.startAttempt({
        formulationName,
        inputs: {
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
        },
      });
      const outcome = await client.waitForFeasibleOutcome(uuid);
      expect(outcome).toMatchObject({isOptimal: true, objectiveValue: 2});
    },
    ATTEMPT_TIMEOUT
  );

  test(
    'runs relaxed sudoku attempt',
    async () => {
      const formulationName = 'sudoku' + SUFFIX;
      await registerSpecification(client, formulationName, 'sudoku.md');
      const {uuid} = await client.startAttempt({
        formulationName,
        inputs: {
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
        },
        options: {
          relaxation: {
            penalty: 'DEVIATION_CARDINALITY',
            constraints: [{label: 'matchHint', deficitBound: -1}],
          },
        },
      });
      const outcome = await client.waitForFeasibleOutcome(uuid);
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
    },
    ATTEMPT_TIMEOUT
  );
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
  await client.registerSpecification({formulationName: name, sources: [src]});
}
