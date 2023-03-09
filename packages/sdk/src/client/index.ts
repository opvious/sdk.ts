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

import * as otel from '@opentelemetry/api';
import * as api from '@opvious/api';
import {absurd, assert, assertCause, check} from '@opvious/stl-errors';
import {noopTelemetry, Telemetry} from '@opvious/stl-telemetry';
import backoff from 'backoff';
import fetch, {FetchError, Response} from 'node-fetch';
import {TypedEmitter} from 'tiny-typed-emitter';

import {MarkPresent, strippingTrailingSlashes} from '../common';
import {
  AttemptTracker,
  AttemptTrackerListeners,
  BlueprintUrls,
  clientErrors,
  FeasibleOutcomeFragment,
  jsonBrotliEncoder,
  Paginated,
  resultData,
  Uuid,
} from './common';

export {
  AttemptTracker,
  AttemptTrackerListeners,
  BlueprintUrls,
  clientErrorCodes,
  FeasibleOutcomeFragment,
  Paginated,
} from './common';

/** Opvious API client. */
export class OpviousClient {
  private constructor(
    private readonly telemetry: Telemetry,
    /** Base endpoint to the GraphQL API. */
    readonly apiEndpoint: string,
    /** Base optimization hub endpoint. */
    readonly hubEndpoint: string,
    private readonly sdk: api.Sdk<typeof fetch>,
    private readonly graphqlSdk: api.GraphqlSdk<typeof fetch>
  ) {}

  /** Creates a new client. */
  static create(opts?: OpviousClientOptions): OpviousClient {
    const tel = opts?.telemetry ?? noopTelemetry();
    const {logger} = tel;

    const auth = opts?.authorization ?? process.env.OPVIOUS_TOKEN;
    if (!auth) {
      throw clientErrors.missingAuthorization();
    }

    const domain = opts?.domain ?? process.env.OPVIOUS_DOMAIN;
    const apiEndpoint = strippingTrailingSlashes(
      opts?.apiEndpoint
        ? '' + opts.apiEndpoint
        : process.env.OPVIOUS_API_ENDPOINT ?? defaultEndpoint('api', domain)
    );
    const hubEndpoint = strippingTrailingSlashes(
      opts?.hubEndpoint
        ? '' + opts.hubEndpoint
        : process.env.OPVIOUS_HUB_ENDPOINT ?? defaultEndpoint('hub', domain)
    );

    const sdk = api.createSdk<typeof fetch>(apiEndpoint, {
      headers: {
        'accept-encoding': 'br;q=1.0, gzip;q=0.5, *;q=0.1',
        authorization: auth.includes(' ') ? auth : 'Bearer ' + auth,
      },
      encoders: {
        'application/json': jsonBrotliEncoder(logger),
      },
      fetch: async (url, init): Promise<Response> => {
        otel.propagation.inject(otel.context.active(), init.headers);
        try {
          return await fetch(url, init);
        } catch (err) {
          assertCause(err instanceof FetchError, err);
          throw clientErrors.fetchFailed(err);
        }
      },
    });
    const graphqlSdk = api.createGraphqlSdk(sdk);

    logger.debug('Created new client.');
    return new OpviousClient(tel, apiEndpoint, hubEndpoint, sdk, graphqlSdk);
  }

  /** Fetches the currently active member. */
  async fetchMember(): Promise<api.graphqlTypes.FetchedMemberFragment> {
    const res = await this.graphqlSdk.FetchMember();
    return resultData(res).me;
  }

  /** Lists all available authorizations. */
  async listAuthorizations(): Promise<
    ReadonlyArray<api.graphqlTypes.ListedAuthorizationFragment>
  > {
    const res = await this.graphqlSdk.ListAuthorizations();
    return resultData(res).me.authorizations;
  }

  /** Creates a new access token for an authorization with the given name. */
  async generateAccessToken(
    input: api.graphqlTypes.GenerateAuthorizationInput
  ): Promise<string> {
    const res = await this.graphqlSdk.GenerateAuthorization({input});
    return resultData(res).generateAuthorization.token;
  }

  /** Revokes an authorization from its name, returning true if one existed. */
  async revokeAuthorization(name: string): Promise<boolean> {
    const res = await this.graphqlSdk.RevokeAuthorization({name});
    return resultData(res).revokeAuthorization;
  }

  /** Parses and validates a specification's sources. */
  async parseSources(
    ...sources: string[]
  ): Promise<api.ResponseData<'parseSources', 200>> {
    const res = await this.sdk.parseSources({body: {sources}});
    switch (res.code) {
      case 200:
        return res.data;
      default:
        throw clientErrors.unexpectedResponse(res.raw, res.data);
    }
  }

  /** Adds a new specification. */
  async registerSpecification(
    input: api.graphqlTypes.RegisterSpecificationInput
  ): Promise<api.graphqlTypes.RegisteredSpecificationFragment> {
    const res = await this.graphqlSdk.RegisterSpecification({input});
    return resultData(res).registerSpecification;
  }

  /** Updates a formulation's metadata. */
  async updateFormulation(
    input: api.graphqlTypes.UpdateFormulationInput
  ): Promise<api.graphqlTypes.UpdatedFormulationFragment> {
    const res = await this.graphqlSdk.UpdateFormulation({input});
    return resultData(res).updateFormulation;
  }

  /** Fetches a formulation's outline. */
  async fetchOutline(
    formulationName: string,
    tagName?: string
  ): Promise<
    MarkPresent<api.graphqlTypes.FetchedOutlineFormulationFragment, 'tag'>
  > {
    const res = await this.graphqlSdk.FetchOutline({
      formulationName,
      tagName,
    });
    const form = resultData(res).formulation;
    if (!form?.tag) {
      throw clientErrors.unknownFormulation(formulationName, tagName);
    }
    return {...form, tag: form.tag};
  }

  /** Paginates available formulations. */
  async paginateFormulations(
    vars: api.graphqlTypes.PaginateFormulationsQueryVariables
  ): Promise<Paginated<api.graphqlTypes.PaginatedFormulationFragment>> {
    const res = await this.graphqlSdk.PaginateFormulations(vars);
    const forms = resultData(res).formulations;
    return {
      info: forms.pageInfo,
      totalCount: forms.totalCount,
      nodes: forms.edges.map((e) => e.node),
    };
  }

  /** Deletes a formulation, returning true if a formulation was deleted. */
  async deleteFormulation(name: string): Promise<boolean> {
    const res = await this.graphqlSdk.DeleteFormulation({name});
    return resultData(res).deleteFormulation.specificationCount > 0;
  }

  /**
   * Makes a formulation's tag publicly accessible via a unique URL. This can be
   * disabled via `unshareFormulation`.
   */
  async shareFormulation(
    input: api.graphqlTypes.StartSharingFormulationInput
  ): Promise<
    MarkPresent<api.graphqlTypes.SharedSpecificationTagFragment, 'sharedVia'>
  > {
    const res = await this.graphqlSdk.StartSharingFormulation({input});
    const tag = resultData(res).startSharingFormulation;
    return {...tag, sharedVia: check.isPresent(tag.sharedVia)};
  }

  /**
   * Makes a formulation's tag(s) private. If not tags are specified, all the
   * formulations tags will be set to private.
   */
  async unshareFormulation(
    input: api.graphqlTypes.StopSharingFormulationInput
  ): Promise<api.graphqlTypes.UnsharedFormulationFragment> {
    const res = await this.graphqlSdk.StopSharingFormulation({input});
    return resultData(res).stopSharingFormulation;
  }

  /** Paginates available attempts. */
  async paginateAttempts(
    vars: api.graphqlTypes.PaginateAttemptsQueryVariables
  ): Promise<Paginated<api.graphqlTypes.PaginatedAttemptFragment>> {
    const res = await this.graphqlSdk.PaginateAttempts(vars);
    const forms = resultData(res).attempts;
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
  async startAttempt(args: {
    readonly formulationName: string;
    readonly specificationTagName?: string;
    readonly inputs: api.types['SolveInputs'];
    readonly options?: api.types['SolveOptions'];
  }): Promise<api.ResponseData<'startAttempt', 200>> {
    const res = await this.sdk.startAttempt({body: args});
    switch (res.code) {
      case 200:
        return res.data;
      default:
        throw clientErrors.unexpectedResponse(res.raw, res.data);
    }
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
      this.graphqlSdk
        .PollAttempt({uuid})
        .then((res) => {
          const {attempt} = resultData(res);
          assert(attempt, 'Unknown attempt');
          switch (attempt.status) {
            case 'PENDING': {
              const notif = attempt.notifications.edges[0]?.node;
              if (notif) {
                ee.emit('notification', notif);
              }
              xb.backoff();
              return;
            }
            case 'CANCELLED':
              throw clientErrors.attemptCancelled(uuid);
            case 'ERRORED': {
              assert(
                attempt.outcome?.__typename === 'FailedOutcome',
                'Unexpected outcome %j',
                attempt.outcome
              );
              throw clientErrors.attemptErrored(uuid, attempt.outcome.failure);
            }
            case 'INFEASIBLE':
              ee.emit('infeasible');
              return;
            case 'UNBOUNDED':
              ee.emit('unbounded');
              return;
            case 'FEASIBLE':
            case 'OPTIMAL': {
              assert(
                attempt.outcome?.__typename === 'FeasibleOutcome',
                'Unexpected outcome %j',
                attempt.outcome
              );
              ee.emit('feasible', attempt.outcome);
              return;
            }
            default:
              absurd(attempt.status);
          }
        })
        .catch((err) => {
          ee.emit('error', err);
        });
    }).backoff();
    return ee;
  }

  /**
   * Convenience method which resolves when the attempt is solved. Consider
   * using `trackAttempt` to get access to progress notifications and other
   * statuses.
   */
  async waitForFeasibleOutcome(uuid: Uuid): Promise<FeasibleOutcomeFragment> {
    return new Promise((ok, fail) => {
      this.trackAttempt(uuid)
        .on('error', fail)
        .on('feasible', ok)
        .on('infeasible', () => {
          fail(new Error('Infeasible problem'));
        })
        .on('unbounded', () => {
          fail(new Error('Unbounded problem'));
        });
    });
  }

  /** Cancels a pending attempt. */
  async cancelAttempt(
    uuid: Uuid
  ): Promise<api.graphqlTypes.CancelledAttemptFragment> {
    const res = await this.graphqlSdk.CancelAttempt({uuid});
    return resultData(res).cancelAttempt;
  }

  /** Fetches an attempt from its UUID. */
  async fetchAttempt(
    uuid: Uuid
  ): Promise<api.graphqlTypes.FetchedAttemptFragment | undefined> {
    const res = await this.graphqlSdk.FetchAttempt({uuid});
    return resultData(res).attempt;
  }

  /** Paginates an attempt's notifications. */
  async paginateAttemptNotifications(
    vars: api.graphqlTypes.PaginateAttemptNotificationsQueryVariables
  ): Promise<Paginated<api.graphqlTypes.FullAttemptNotificationFragment>> {
    const res = await this.graphqlSdk.PaginateAttemptNotifications(vars);
    const notifs = resultData(res).attempt?.notifications;
    if (!notifs) {
      throw clientErrors.unknownAttempt(vars.uuid);
    }
    return {
      info: notifs.pageInfo,
      totalCount: notifs.totalCount,
      nodes: notifs.edges.map((e) => e.node),
    };
  }

  /** Fetches an attempt's inputs from its UUID. */
  async fetchAttemptInputs(uuid: Uuid): Promise<api.types['SolveInputs']> {
    const res = await this.sdk.getAttemptInputs({
      parameters: {attemptUuid: uuid},
    });
    switch (res.code) {
      case 200:
        return res.data;
      case 404:
        throw clientErrors.unknownAttempt(uuid);
      default:
        throw clientErrors.unexpectedResponse(res.raw, res.data);
    }
  }

  /**
   * Fetches an attempt's outputs from its UUID. This method will returned
   * `undefined` if the attempt was not feasible.
   * */
  async fetchAttemptOutputs(
    uuid: Uuid
  ): Promise<api.types['SolveOutputs'] | undefined> {
    const res = await this.sdk.getAttemptOutputs({
      parameters: {attemptUuid: uuid},
    });
    switch (res.code) {
      case 200:
        return res.data;
      case 404:
        throw clientErrors.unknownAttempt(uuid);
      case 409:
        return undefined;
      default:
        throw clientErrors.unexpectedResponse(res.raw, res.data);
    }
  }

  formulationUrl(name: string): URL {
    return new URL(this.hubEndpoint + `/formulations/${name}`);
  }

  specificationUrl(formulation: string, revno: number): URL {
    const pathname = `/formulations/${formulation}/overview/${revno}`;
    return new URL(this.hubEndpoint + pathname);
  }

  attemptUrl(uuid: Uuid): URL {
    return new URL(this.hubEndpoint + `/attempts/${uuid}`);
  }

  blueprintUrls(slug: string): BlueprintUrls {
    const suffix = `/blueprints/${slug}`;
    return {
      apiUrl: new URL(this.apiEndpoint + suffix),
      hubUrl: new URL(this.hubEndpoint + suffix),
    };
  }
}

export interface OpviousClientOptions {
  /**
   * API authorization header or access token, defaulting to
   * `process.env.OPVIOUS_TOKEN`.
   */
  readonly authorization?: string;

  /** Telemetry instance used for logging, etc. */
  readonly telemetry?: Telemetry;

  /**
   * API and hub parent domain. If unset, uses `process.env.OPVIOUS_DOMAIN` if
   * set. See `apiEndpoint` and `hubEndpoint` for additional configuration
   * granularity.
   */
  readonly domain?: string;

  /**
   * Base API endpoint URL. If unset, uses `process.env.OPVIOUS_API_ENDPOINT` if
   * set, and falls back to the default domain's endpoint otherwise.
   */
  readonly apiEndpoint?: string | URL;

  /**
   * Base model hub endpoint URL. If unset, uses
   * `process.env.OPVIOUS_HUB_ENDPOINT` if set, and falls back to the default
   * domain's endpoint otherwise.
   */
  readonly hubEndpoint?: string | URL;
}

const DEFAULT_DOMAIN = 'beta.opvious.io';

function defaultEndpoint(leaf: string, domain = DEFAULT_DOMAIN): string {
  return `https://${leaf}.${domain}`;
}
