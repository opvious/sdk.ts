import {RecordingTelemetry} from '@opvious/stl-telemetry';
import {waitForEvent} from '@opvious/stl-utils/events';
import {ResourceLoader} from '@opvious/stl-utils/files';

import * as sut from '../src/index.js';

const telemetry = RecordingTelemetry.forTesting();

const loader = ResourceLoader.enclosing(import.meta.url).scoped('test');

const client = sut.OpviousClient.create({telemetry});

const NAME_SUFFIX = '-ts-sdk-test';

const ATTEMPT_TIMEOUT = 20_000;

const SOLVE_TIMEOUT = 10_000;

describe.skipIf(!client.authenticated)('client', () => {
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

  test('register and deletes specification', async () => {
    const formulationName = 'n-queens' + NAME_SUFFIX;
    const {contents} = await loader.load('sources/n-queens.md');
    await client.registerSpecification({formulationName, sources: [contents]});
    await client.deleteFormulation(formulationName);
  });

  test('paginates formulations', async () => {
    const formulationName = 'n-queens' + NAME_SUFFIX;
    const {contents} = await loader.load('sources/n-queens.md');
    await client.registerSpecification({formulationName, sources: [contents]});
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
      const formulationName = 'n-queens' + NAME_SUFFIX;
      const {contents: src} = await loader.load('sources/n-queens.md');
      await client.registerSpecification({formulationName, sources: [src]});

      const {uuid} = await client.startAttempt({
        candidate: {
          formulation: {name: formulationName},
          inputs: {
            parameters: [{label: 'size', entries: [{key: [], value: 5}]}],
          },
          options: {timeoutMillis: 5_000},
        },
      });

      const outcome = await client.waitForFeasibleOutcome(uuid);
      expect(outcome).toMatchObject({isOptimal: true});

      const fetched = await client.fetchAttempt(uuid);
      expect(fetched).toMatchObject({solveOptions: {timeoutMillis: 5_000}});

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
    },
    ATTEMPT_TIMEOUT
  );

  test(
    'solves set-cover',
    async () => {
      const {contents} = await loader.load('sources/set-cover.md');
      const tracker = client
        .runSolve({
          candidate: {
            formulation: {sources: [contents]},
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
          },
        })
        .on('reified', (summary) => {
          expect(summary).toMatchObject({
            parameters: [{label: 'coverage', entryProfile: {count: 4}}],
          });
        });
      const [outcome] = await waitForEvent(tracker, 'solved');
      expect(outcome.status).toEqual('OPTIMAL');
      expect.assertions(2);
    },
    SOLVE_TIMEOUT
  );

  test(
    'solves relaxed sudoku attempt',
    async () => {
      const formulationName = 'sudoku' + NAME_SUFFIX;

      const {contents: src} = await loader.load('sources/sudoku.md');
      await client.registerSpecification({formulationName, sources: [src]});

      const candidate = await sut.loadSolveCandidate(
        loader.localUrl('candidates/relaxed-sudoku.yaml')
      );
      const tracker = await client.runSolve({candidate});
      const [outcome, outputs] = await waitForEvent(tracker, 'solved');

      expect(outcome.status).toEqual('OPTIMAL');
      expect(outputs).toMatchObject({
        variables: [
          {
            label: 'matchHint_deficit',
            entries: [{key: [1, 0, 3], value: 1}],
          },
          {label: 'positions'},
        ],
      });
    },
    SOLVE_TIMEOUT
  );
});
