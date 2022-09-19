/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with this
 * work for additional information regarding copyright ownership.  The ASF
 * licenses this file to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

import * as gql from 'graphql';
import {GraphQLClient} from 'graphql-request';
import * as api from 'opvious-graph';
import {setTimeout} from 'timers/promises';

export type Definition = api.Scalars['Definition'];

export type Name = api.Scalars['Name'];

/** Opvious API client. */
export class OpviousClient {
  private constructor(private readonly sdk: api.Sdk) {}

  /** Creates a new client. */
  static create(opts?: OpviousClientOptions): OpviousClient {
    const token = opts?.accessToken ?? process.env.OPVIOUS_TOKEN;
    if (!token) {
      throw new Error('Missing Opvious access token');
    }
    const apiEndpoint = opts?.apiEndpoint
      ? '' + opts.apiEndpoint
      : process.env.OPVIOUS_ENDPOINT ?? api.ENDPOINT;
    const client = new GraphQLClient(apiEndpoint, {
      headers: {
        authorization: 'Bearer ' + token,
        'opvious-client': 'TypeScript SDK',
      },
    });
    const sdk = api.getSdk(<R, V>(query: string, vars: V) =>
      client.rawRequest<R, V>(query, vars)
    );
    return new OpviousClient(sdk);
  }

  async extractDefinitions(source: string): Promise<ReadonlyArray<Definition>> {
    const res = await this.sdk.ExtractDefinitions({sources: [source]});
    assertNoErrors(res);
    const defs: any[] = [];
    for (const slice of checkPresent(res.data).extractDefinitions.slices) {
      if (slice.__typename === 'InvalidSourceSlice') {
        throw new Error(slice.errorMessage);
      }
      defs.push(slice.definition);
    }
    return defs;
  }

  async registerSpecification(args: {
    readonly source: string;
    readonly formulationName: string;
    readonly tagNames?: ReadonlyArray<Name>;
  }): Promise<void> {
    const defs = await this.extractDefinitions(args.source);
    await this.sdk.RegisterSpecification({
      input: {
        definitions: defs,
        formulationName: args.formulationName,
        tagNames: args.tagNames,
      },
    });
  }

  async updateFormulation(args: {
    readonly name: string;
    readonly displayName?: string;
    readonly description?: string;
    readonly url?: string;
  }): Promise<void> {
    const res = await this.sdk.UpdateFormulation({
      input: {
        name: args.name,
        patch: {
          description: args.description,
          displayName: args.displayName,
          url: args.url,
        },
      },
    });
    assertNoErrors(res);
  }

  async deleteFormulation(name: string): Promise<void> {
    const res = await this.sdk.DeleteFormulation({name});
    assertNoErrors(res);
  }

  async runAttempt(args: {
    readonly formulationName: string;
    readonly tagName?: string;
    readonly parameters?: ReadonlyArray<api.ParameterInput>;
    readonly dimensions?: ReadonlyArray<api.DimensionInput>;
    readonly pinnedVariables?: ReadonlyArray<api.PinnedVariableInput>;
  }): Promise<Omit<api.FeasibleOutcome, 'constraintResults'>> {
    const startRes = await this.sdk.StartAttempt({input: {...args}});
    assertNoErrors(startRes);
    const uuid = checkPresent(startRes.data).startAttempt.uuid;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await setTimeout(POLL_ATTEMPT_INTERVAL_MILLIS);
      const pollRes = await this.sdk.PollAttempt({uuid});
      assertNoErrors(pollRes);
      const attempt = checkPresent(pollRes.data?.attempt);
      const {outcome, status} = attempt;
      switch (status) {
        case 'PENDING':
          break;
        case 'FEASIBLE':
        case 'OPTIMAL':
          assert(outcome?.__typename === 'FeasibleOutcome');
          return outcome;
        case 'FAILED':
          assert(outcome?.__typename === 'FailedOutcome');
          throw new Error(
            'Attempt failed: ' + JSON.stringify(outcome.failure, null, 2)
          );
        case 'UNBOUNDED':
          throw new Error('Attempt was unbounded');
        case 'INFEASIBLE':
          throw new Error('Attempt was infeasible');
      }
    }
  }
}

function assert(pred: unknown): asserts pred {
  if (!pred) {
    throw new Error('Assertion failed');
  }
}

function assertNoErrors<V>(res: gql.ExecutionResult<V, unknown>): void {
  if (res.errors?.length) {
    throw new Error('API call failed: ' + JSON.stringify(res.errors, null, 2));
  }
}

function checkPresent<V>(arg: V | undefined | null): V {
  assert(arg != null);
  return arg;
}

const POLL_ATTEMPT_INTERVAL_MILLIS = 2_500;

export interface OpviousClientOptions {
  /** API authorization token, defaulting to `process.env.OPVIOUS_TOKEN`. */
  readonly accessToken?: string;

  /**
   * GraphQL endpoint URL. If unset, uses `process.env.OPVIOUS_ENDPOINT` if set,
   * and falls back to the default production endpoint otherwise.
   */
  readonly apiEndpoint?: string | URL;
}
