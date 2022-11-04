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
import events from 'events';
import {GraphQLClient} from 'graphql-request';
import fetch, {Headers, RequestInfo, RequestInit, Response} from 'node-fetch';
import * as g from 'opvious-graph';
import {TypedEmitter} from 'tiny-typed-emitter';
import zlib from 'zlib';

import {
  assert,
  assertNoErrors,
  checkPresent,
  MarkPresent,
  strippingTrailingSlashes,
} from '../common';
import {
  AttemptTracker,
  AttemptTrackerListeners,
  BlueprintUrls,
  Name,
  Paginated,
  Uuid,
} from './types';

export {
  AttemptTracker,
  AttemptTrackerListeners,
  BlueprintUrls,
  Paginated,
} from './types';

/** Opvious API client. */
export class OpviousClient {
  private constructor(
    /** Base endpoint to the GraphQL API. */
    readonly apiEndpoint: string,
    /** Base optimization hub endpoint. */
    readonly hubEndpoint: string,
    private readonly sdk: g.Sdk
  ) {}

  /** Creates a new client. */
  static create(opts?: OpviousClientOptions): OpviousClient {
    const auth = opts?.authorization ?? process.env.OPVIOUS_TOKEN;
    if (!auth) {
      throw new Error('Missing authorization');
    }
    const apiEndpoint = strippingTrailingSlashes(
      opts?.apiEndpoint
        ? '' + opts.apiEndpoint
        : process.env.OPVIOUS_API_ENDPOINT ?? DefaultEndpoint.API
    );
    const threshold = ENCODING_THRESHOLD;
    const client = new GraphQLClient(apiEndpoint + '/graphql', {
      headers: {
        authorization: auth.includes(' ') ? auth : 'Bearer ' + auth,
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

  /** Fetch currently active account information. */
  async fetchMyAccount(): Promise<g.MyAccountFragment> {
    const res = await this.sdk.FetchMyAccount();
    assertNoErrors(res);
    return checkPresent(res.data?.me);
  }

  /** Lists all available authorizations. */
  async listAuthorizations(): Promise<
    ReadonlyArray<g.ListedAuthorizationFragment>
  > {
    const res = await this.sdk.ListMyAuthorizations();
    assertNoErrors(res);
    return checkPresent(res.data?.me.holder).authorizations;
  }

  /** Creates a new access token for an authorization with the given name. */
  async generateAccessToken(
    input: g.GenerateAuthorizationInput
  ): Promise<string> {
    const res = await this.sdk.GenerateAuthorization({input});
    assertNoErrors(res);
    return checkPresent(res.data).generateAuthorization.token;
  }

  /** Revokes an authorization from its name, returning true if one existed. */
  async revokeAuthorization(name: string): Promise<boolean> {
    const res = await this.sdk.RevokeAuthorization({name});
    assertNoErrors(res);
    return checkPresent(res.data).revokeAuthorization;
  }

  /**
   * Extracts definitions from one or more sources. These definitions can then
   * be used to register a specification.
   */
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

  /** Validates that the definitions are valid for registration. */
  async validateDefinitions(
    defs: ReadonlyArray<g.Definition>
  ): Promise<ReadonlyArray<string>> {
    const res = await this.sdk.ValidateDefinitions({definitions: defs});
    assertNoErrors(res);
    return checkPresent(res.data).validateDefinitions.warnings ?? [];
  }

  /** Adds a new specification. */
  async registerSpecification(
    input: g.RegisterSpecificationInput
  ): Promise<g.RegisteredSpecificationFragment> {
    const res = await this.sdk.RegisterSpecification({input});
    assertNoErrors(res);
    return checkPresent(res.data).registerSpecification;
  }

  /** Updates a formulation's metadata. */
  async updateFormulation(
    input: g.UpdateFormulationInput
  ): Promise<g.UpdatedFormulationFragment> {
    const res = await this.sdk.UpdateFormulation({input});
    assertNoErrors(res);
    return checkPresent(res.data).updateFormulation;
  }

  /** Fetches a formulation's outline. */
  async fetchOutline(
    formulationName: Name,
    tagName?: Name
  ): Promise<MarkPresent<g.FetchedOutlineFormulationFragment, 'tag'>> {
    const res = await this.sdk.FetchOutline({
      formulationName,
      tagName,
    });
    assertNoErrors(res);
    const form = checkPresent(res.data).formulation;
    if (!form?.tag) {
      throw new Error('No such specification');
    }
    return {...form, tag: form.tag};
  }

  /** Paginates available formulations. */
  async paginateFormulations(
    vars: g.PaginateFormulationsQueryVariables
  ): Promise<Paginated<g.PaginatedFormulationFragment>> {
    const res = await this.sdk.PaginateFormulations(vars);
    assertNoErrors(res);
    const forms = checkPresent(res.data).formulations;
    return {
      info: forms.pageInfo,
      totalCount: forms.totalCount,
      nodes: forms.edges.map((e) => e.node),
    };
  }

  /** Deletes a formulation, returning true if a formulation was deleted. */
  async deleteFormulation(name: Name): Promise<boolean> {
    const res = await this.sdk.DeleteFormulation({name});
    assertNoErrors(res);
    return checkPresent(res.data).deleteFormulation.specificationCount > 0;
  }

  /**
   * Makes a formulation's tag publicly accessible via a unique URL. This can be
   * disabled via `unshareFormulation`.
   */
  async shareFormulation(
    input: g.StartSharingFormulationInput
  ): Promise<MarkPresent<g.SharedSpecificationTagFragment, 'sharedVia'>> {
    const res = await this.sdk.StartSharingFormulation({input});
    assertNoErrors(res);
    const tag = checkPresent(res.data).startSharingFormulation;
    return {...tag, sharedVia: checkPresent(tag.sharedVia)};
  }

  /**
   * Makes a formulation's tag(s) private. If not tags are specified, all the
   * formulations tags will be set to private.
   */
  async unshareFormulation(
    input: g.StopSharingFormulationInput
  ): Promise<void> {
    const res = await this.sdk.StopSharingFormulation({input});
    assertNoErrors(res);
  }

  /** Paginates available attempts. */
  async paginateAttempts(
    vars: g.PaginateAttemptsQueryVariables
  ): Promise<Paginated<g.PaginatedAttemptFragment>> {
    const res = await this.sdk.PaginateAttempts(vars);
    assertNoErrors(res);
    const forms = checkPresent(res.data).attempts;
    return {
      info: forms.pageInfo,
      totalCount: forms.totalCount,
      nodes: forms.edges.map((e) => e.node),
    };
  }

  /**
   * Starts a new attempt. The attempt will run asynchronously; use the returned
   * UUID to wait for its outcome (via `waitForOutcome`), fetch its inputs and
   * outputs, etc.
   */
  async startAttempt(input: g.AttemptInput): Promise<g.StartedAttemptFragment> {
    const startRes = await this.sdk.StartAttempt({input});
    assertNoErrors(startRes);
    return checkPresent(startRes.data).startAttempt;
  }

  /**
   * Tracks an attempt until its outcome is decided, emitting it as `'outcome'`.
   * `'notification'` events will periodically be emitted containing the
   * attempt's latest progress. If the attempt failed (error, infeasible,
   * unbounded), the event emitter will emit an error.
   */
  trackAttempt(uuid: Uuid): AttemptTracker {
    const ee = new TypedEmitter<AttemptTrackerListeners>();
    const xb = backoff.exponential();
    xb.on('ready', () => {
      this.sdk
        .PollAttempt({uuid})
        .then((res) => {
          assertNoErrors(res);
          const attempt = checkPresent(res.data?.attempt);
          switch (attempt.status) {
            case 'PENDING': {
              const notif = attempt.notifications.edges[0]?.node;
              if (notif) {
                ee.emit('notification', notif);
              }
              xb.backoff();
              return;
            }
            case 'INFEASIBLE':
              throw new Error('Infeasible attempt');
            case 'UNBOUNDED':
              throw new Error('Unbounded attempt');
          }
          const outcome = checkPresent(attempt.outcome);
          if (outcome.__typename === 'FailedOutcome') {
            throw new Error(outcome.failure.message);
          }
          ee.emit('outcome', outcome);
        })
        .catch((err) => {
          ee.emit('error', err);
        });
    }).backoff();
    return ee;
  }

  /**
   * Convenience method which resolves when the attempt is solved. Consider
   * using `trackAttempt` to get access to progress notifications.
   */
  async waitForOutcome(uuid: Uuid): Promise<g.PolledAttemptOutcomeFragment> {
    const ee = this.trackAttempt(uuid);
    const [outcome] = await events.once(ee, 'outcome');
    return outcome;
  }

  /** Cancels a pending attempt. */
  async cancelAttempt(uuid: Uuid): Promise<void> {
    const res = await this.sdk.CancelAttempt({uuid});
    assertNoErrors(res);
  }

  /** Fetches an attempt from its UUID. */
  async fetchAttempt(
    uuid: Uuid
  ): Promise<g.FetchedAttemptFragment | undefined> {
    const res = await this.sdk.FetchAttempt({uuid});
    assertNoErrors(res);
    return checkPresent(res.data).attempt;
  }

  /** Paginates an attempt's notifications. */
  async paginateAttemptNotifications(
    vars: g.PaginateAttemptNotificationsQueryVariables
  ): Promise<Paginated<g.FullAttemptNotificationFragment>> {
    const res = await this.sdk.PaginateAttemptNotifications(vars);
    assertNoErrors(res);
    const notifs = checkPresent(res.data).attempt?.notifications;
    if (!notifs) {
      throw attemptNotFoundError(vars.uuid);
    }
    return {
      info: notifs.pageInfo,
      totalCount: notifs.totalCount,
      nodes: notifs.edges.map((e) => e.node),
    };
  }

  /** Fetches an attempt's inputs from its UUID. */
  async fetchAttemptInputs(
    uuid: Uuid
  ): Promise<g.FetchedAttemptInputsFragment | undefined> {
    const res = await this.sdk.FetchAttemptInputs({uuid});
    assertNoErrors(res);
    const attempt = checkPresent(res.data).attempt;
    if (!attempt) {
      throw attemptNotFoundError(uuid);
    }
    return attempt;
  }

  /**
   * Fetches an attempt's outputs from its UUID. This method will returned
   * `undefined` if the attempt is not feasible (e.g. still pending).
   * */
  async fetchAttemptOutputs(
    uuid: Uuid
  ): Promise<g.FetchedAttemptOutputsFragment | undefined> {
    const res = await this.sdk.FetchAttemptOutputs({uuid});
    assertNoErrors(res);
    const attempt = checkPresent(res.data).attempt;
    if (!attempt) {
      throw attemptNotFoundError(uuid);
    }
    const {outcome} = attempt;
    return outcome?.__typename === 'FeasibleOutcome' ? outcome : undefined;
  }

  formulationUrl(name: Name): URL {
    return new URL(this.hubEndpoint + `/formulations/${name}`);
  }

  specificationUrl(formulation: Name, revno: number): URL {
    const pathname = `/formulations/${formulation}/overview/${revno}`;
    return new URL(this.hubEndpoint + pathname);
  }

  attemptUrl(uuid: Uuid): URL {
    return new URL(this.hubEndpoint + `/attempts/${uuid}`);
  }

  blueprintUrls(slug: string): BlueprintUrls {
    return {
      apiUrl: new URL(this.apiEndpoint + `/sharing/blueprints/${slug}`),
      hubUrl: new URL(this.hubEndpoint + `/blueprints/${slug}`),
    };
  }
}

export interface OpviousClientOptions {
  /**
   * API authorization header or access token, defaulting to
   * `process.env.OPVIOUS_AUTHORIZATION`.
   */
  readonly authorization?: string;

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

enum DefaultEndpoint {
  API = 'https://api.opvious.io',
  HUB = 'https://hub.opvious.io',
}

const ENCODING_HEADER = 'content-encoding';

const ENCODING_THRESHOLD = 2 ** 16; // 64 kiB

function attemptNotFoundError(uuid: Uuid): Error {
  return new Error('Attempt not found: ' + uuid);
}
