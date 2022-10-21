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

import {GraphQLClient} from 'graphql-request';
import fetch, {Headers, RequestInfo, RequestInit, Response} from 'node-fetch';
import * as g from 'opvious-graph';
import {setTimeout} from 'timers/promises';
import zlib from 'zlib';

import {
  assert,
  assertNoErrors,
  checkPresent,
  strippingTrailingSlashes,
} from './common';

export * as graph from 'opvious-graph';

/** Opvious API client. */
export class OpviousClient {
  private constructor(
    readonly apiEndpoint: string,
    readonly hubEndpoint: string,
    private readonly sdk: g.Sdk
  ) {}

  /** Creates a new client. */
  static create(opts?: OpviousClientOptions): OpviousClient {
    const token = opts?.accessToken ?? process.env.OPVIOUS_TOKEN;
    if (!token) {
      throw new Error('Missing Opvious access token');
    }
    const apiEndpoint = strippingTrailingSlashes(
      opts?.apiEndpoint
        ? '' + opts.apiEndpoint
        : process.env.OPVIOUS_API_ENDPOINT ?? DefaultEndpoint.API
    );
    const threshold = ENCODING_THRESHOLD;
    const client = new GraphQLClient(apiEndpoint + '/graphql', {
      headers: {
        authorization: 'Bearer ' + token,
        'opvious-client': 'TypeScript SDK',
      },
      fetch(info: RequestInfo, init: RequestInit): Promise<Response> {
        const {body} = init;
        if (typeof body != 'string' || body.length <= threshold) {
          return fetch(info, init);
        }
        const headers = new Headers(init.headers);
        assert(!headers.get(ENCODING_HEADER));
        headers.set(ENCODING_HEADER, 'gzip');
        const gzip = zlib.createGzip();
        process.nextTick(() => {
          gzip.end(body);
        });
        return fetch(info, {...init, headers, body: gzip});
      },
    });
    const sdk = g.getSdk(<R, V>(query: string, vars: V) =>
      client.rawRequest<R, V>(query, vars)
    );
    const hubEndpoint = strippingTrailingSlashes(
      opts?.hubEndpoint
        ? '' + opts.hubEndpoint
        : process.env.OPVIOUS_HUB_ENDPOINT ?? DefaultEndpoint.HUB
    );
    return new OpviousClient(apiEndpoint, hubEndpoint, sdk);
  }

  async extractDefinitions(
    source: string
  ): Promise<ReadonlyArray<g.Definition>> {
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
    readonly formulationName: Name;
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
    readonly name: Name;
    readonly displayName?: string;
  }): Promise<void> {
    const res = await this.sdk.UpdateFormulation({
      input: {
        name: args.name,
        patch: {displayName: args.displayName},
      },
    });
    assertNoErrors(res);
  }

  async deleteFormulation(name: Name): Promise<void> {
    const res = await this.sdk.DeleteFormulation({name});
    assertNoErrors(res);
  }

  async startAttempt(args: g.AttemptInput): Promise<string> {
    const startRes = await this.sdk.StartAttempt({input: {...args}});
    assertNoErrors(startRes);
    return checkPresent(startRes.data).startAttempt.uuid;
  }

  async runAttempt(args: {
    readonly formulationName: Name;
    readonly tagName?: Name;
    readonly parameters?: ReadonlyArray<g.ParameterInput>;
    readonly dimensions?: ReadonlyArray<g.DimensionInput>;
    readonly pinnedVariables?: ReadonlyArray<g.PinnedVariableInput>;
    readonly relaxation?: g.RelaxationInput;
  }): Promise<g.PolledAttemptFragment> {
    const startRes = await this.sdk.StartAttempt({input: {...args}});
    assertNoErrors(startRes);
    const uuid = checkPresent(startRes.data).startAttempt.uuid;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await setTimeout(POLL_ATTEMPT_INTERVAL_MILLIS);
      const pollRes = await this.sdk.PollAttempt({uuid});
      assertNoErrors(pollRes);
      const attempt = checkPresent(pollRes.data?.attempt);
      const {status} = attempt;
      if (status !== 'PENDING') {
        return attempt;
      }
    }
  }

  async fetchAttempt(
    uuid: Uuid
  ): Promise<g.FetchedAttemptFragment | undefined> {
    const res = await this.sdk.FetchAttempt({uuid});
    assertNoErrors(res);
    return res.data?.attempt;
  }

  async fetchAttemptInputs(
    uuid: Uuid
  ): Promise<g.FetchedAttemptInputsFragment | undefined> {
    const res = await this.sdk.FetchAttemptInputs({uuid});
    assertNoErrors(res);
    return res.data?.attempt;
  }

  async fetchAttemptOutputs(
    uuid: Uuid
  ): Promise<g.FetchedAttemptOutputsFragment | undefined> {
    const res = await this.sdk.FetchAttemptOutputs({uuid});
    assertNoErrors(res);
    const outcome = res.data?.attempt?.outcome;
    if (outcome?.__typename !== 'FeasibleOutcome') {
      return undefined;
    }
    return outcome;
  }

  async shareFormulation(args: {
    readonly name: Name;
    readonly tagName: Name;
  }): Promise<SharedFormulation> {
    const res = await this.sdk.StartSharingFormulation({input: args});
    assertNoErrors(res);
    const {sharedVia} = checkPresent(res.data).startSharingFormulation;
    return {
      apiUrl: new URL(`${this.apiEndpoint}/sharing/blueprints/${sharedVia}`),
      hubUrl: new URL(`${this.hubEndpoint}/blueprints/${sharedVia}`),
    };
  }

  async unshareFormulation(args: {
    readonly name: Name;
    readonly tagNames?: ReadonlyArray<Name>;
  }): Promise<void> {
    const res = await this.sdk.StopSharingFormulation({input: args});
    assertNoErrors(res);
  }
}

export interface OpviousClientOptions {
  /** API authorization token, defaulting to `process.env.OPVIOUS_TOKEN`. */
  readonly accessToken?: string;

  /**
   * Base API endpoint URL. If unset, uses `process.env.OPVIOUS_API_ENDPOINT` if
   * set, and falls back to the default production endpoint otherwise.
   */
  readonly apiEndpoint?: string | URL;

  /**
   * Base model hub endpoint URL. If unset, uses
   * `process.env.OPVIOUS_HUB_ENDPOINT` if set, and falls back to the default
   * production endpoint otherwise.
   */
  readonly hubEndpoint?: string | URL;
}

export interface SharedFormulation {
  readonly apiUrl: URL;
  readonly hubUrl: URL;
}

type Name = g.Scalars['Name'];
type Uuid = g.Scalars['Uuid'];

enum DefaultEndpoint {
  API = 'https://api.opvious.io/',
  HUB = 'https://hub.opvious.io/',
}

const ENCODING_HEADER = 'content-encoding';

const ENCODING_THRESHOLD = 2 ** 16; // 64 kiB

const POLL_ATTEMPT_INTERVAL_MILLIS = 2_500;
