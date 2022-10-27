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

import backoff from 'backoff';
import {GraphQLClient} from 'graphql-request';
import fetch, {Headers, RequestInfo, RequestInit, Response} from 'node-fetch';
import * as g from 'opvious-graph';
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
    ...sources: string[]
  ): Promise<ReadonlyArray<g.Definition>> {
    const res = await this.sdk.ExtractDefinitions({sources});
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

  async registerSpecification(
    input: g.RegisterSpecificationInput
  ): Promise<SpecificationInfo> {
    const res = await this.sdk.RegisterSpecification({input});
    assertNoErrors(res);
    const spec = checkPresent(res.data?.registerSpecification);
    return {
      formulation: {
        name: spec.formulation.name,
        displayName: spec.formulation.displayName,
        hubUrl: this.formulationUrl(spec.formulation.name),
      },
      revno: spec.revno,
      hubUrl: this.specificationUrl(spec.formulation.name, spec.revno),
    };
  }

  async updateFormulation(
    input: g.UpdateFormulationInput
  ): Promise<FormulationInfo> {
    const res = await this.sdk.UpdateFormulation({input});
    assertNoErrors(res);
    const form = checkPresent(res.data?.updateFormulation);
    return {
      name: input.name,
      displayName: form.displayName,
      hubUrl: this.formulationUrl(input.name),
    };
  }

  async listFormulations(
    vars: g.PaginateFormulationsQueryVariables
  ): Promise<ReadonlyArray<FormulationInfo>> {
    const res = await this.sdk.PaginateFormulations(vars);
    assertNoErrors(res);
    return checkPresent(res.data).formulations.edges.map((e) => ({
      name: e.node.name,
      displayName: e.node.displayName,
      hubUrl: this.formulationUrl(e.node.name),
    }));
  }

  async deleteFormulation(name: Name): Promise<void> {
    const res = await this.sdk.DeleteFormulation({name});
    assertNoErrors(res);
  }

  async startAttempt(input: g.AttemptInput): Promise<AttemptInfo> {
    const startRes = await this.sdk.StartAttempt({input});
    assertNoErrors(startRes);
    const attempt = checkPresent(startRes.data?.startAttempt);
    return {
      uuid: attempt.uuid,
      hubUrl: this.attemptUrl(attempt.uuid),
    };
  }

  async waitForOutcome(uuid: Uuid): Promise<OutcomeInfo> {
    const xb = backoff.exponential();
    return new Promise((ok, fail) => {
      xb.on('ready', () => {
        this.sdk
          .PollAttempt({uuid})
          .then((res) => {
            assertNoErrors(res);
            const attempt = checkPresent(res.data?.attempt);
            switch (attempt.status) {
              case 'PENDING':
                xb.backoff();
                return;
              case 'INFEASIBLE':
                throw new Error('Infeasible attempt');
              case 'UNBOUNDED':
                throw new Error('Unbounded attempt');
            }
            const outcome = checkPresent(attempt.outcome);
            if (outcome.__typename === 'FailedOutcome') {
              throw new Error(outcome.failure.message);
            }
            ok(outcome);
          })
          .catch(fail);
      }).backoff();
    });
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

  async shareFormulation(
    input: g.StartSharingFormulationInput
  ): Promise<BlueprintInfo> {
    const res = await this.sdk.StartSharingFormulation({input});
    assertNoErrors(res);
    const {sharedVia} = checkPresent(res.data).startSharingFormulation;
    return {
      apiUrl: new URL(`${this.apiEndpoint}/sharing/blueprints/${sharedVia}`),
      hubUrl: new URL(`${this.hubEndpoint}/blueprints/${sharedVia}`),
    };
  }

  async unshareFormulation(
    input: g.StopSharingFormulationInput
  ): Promise<void> {
    const res = await this.sdk.StopSharingFormulation({input});
    assertNoErrors(res);
  }

  private formulationUrl(formulation: string): URL {
    return new URL(this.hubEndpoint + `/formulations/${formulation}`);
  }

  private specificationUrl(formulation: string, revno: number): URL {
    const pathname = `/formulations/${formulation}/overview/${revno}`;
    return new URL(this.hubEndpoint + pathname);
  }

  private attemptUrl(uuid: string): URL {
    return new URL(this.hubEndpoint + `/attempts/${uuid}`);
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

export interface FormulationInfo {
  readonly name: Name;
  readonly displayName: string;
  readonly hubUrl: URL;
}

export interface SpecificationInfo {
  readonly formulation: FormulationInfo;
  readonly revno: number;
  readonly hubUrl: URL;
}

export interface AttemptInfo {
  readonly uuid: Uuid;
  readonly hubUrl: URL;
}

export interface OutcomeInfo {
  readonly objectiveValue: number;
  readonly relativeGap?: number;
  readonly isOptimal: boolean;
}

export interface BlueprintInfo {
  readonly apiUrl: URL;
  readonly hubUrl: URL;
}

export type Name = g.Scalars['Name'];
export type Uuid = g.Scalars['Uuid'];

enum DefaultEndpoint {
  API = 'https://api.opvious.io',
  HUB = 'https://hub.opvious.io',
}

const ENCODING_HEADER = 'content-encoding';

const ENCODING_THRESHOLD = 2 ** 16; // 64 kiB
