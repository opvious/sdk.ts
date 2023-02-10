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
import * as api from '@opvious/api-operations';
import {absurd,assert, assertCause, check} from '@opvious/stl-errors';
import {noopTelemetry, Telemetry} from '@opvious/stl-telemetry';
import backoff from 'backoff';
import {ClientError, GraphQLClient} from 'graphql-request';
import fetch, {Headers, RequestInfo, RequestInit, Response} from 'node-fetch';
import {TypedEmitter} from 'tiny-typed-emitter';
import zlib from 'zlib';

import {MarkPresent, strippingTrailingSlashes} from '../common';
import {
  AttemptTracker,
  AttemptTrackerListeners,
  BlueprintUrls,
  clientErrors,
  FeasibleOutcomeFragment,
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
    private readonly sdk: api.Sdk
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
    const client = new GraphQLClient(apiEndpoint + '/graphql', {
      errorPolicy: 'all',
      headers: {
        'accept-encoding': 'br;q=1.0, gzip;q=0.5, *;q=0.1',
        authorization: auth.includes(' ') ? auth : 'Bearer ' + auth,
      },
      async fetch(info: RequestInfo, init: RequestInit): Promise<Response> {
        const {body} = init;
        const headers = new Headers(init.headers);
        otel.propagation.inject(otel.context.active(), headers, {
          set(carrier, key, value) {
            carrier.set(key, value);
          },
        });
        assert(typeof body == 'string', 'Non-string body');
        let res;
        if (body.length <= COMPRESSION_THRESHOLD) {
          logger.debug(
            {data: {req: {body, headers: Object.fromEntries(headers)}}},
            'Sending uncompressed API request...'
          );
          res = await fetch(info, {...init, headers});
        } else {
          const headers = new Headers(init.headers);
          headers.set(ENCODING_HEADER, 'br');
          const compressed = zlib.createBrotliCompress({
            params: {
              [zlib.constants.BROTLI_PARAM_MODE]:
                zlib.constants.BROTLI_MODE_TEXT,
              [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
            },
          });
          process.nextTick(() => {
            compressed.end(body);
          });
          logger.debug(
            {
              data: {
                req: {
                  bodyLength: body.length,
                  headers: Object.fromEntries(headers),
                },
              },
            },
            'Sending compressed API request...'
          );
          res = await fetch(info, {...init, headers, body: compressed});
        }
        logger.debug(
          {
            data: {
              res: {
                headers: Object.fromEntries(res.headers),
                statusCode: res.status,
              },
            },
          },
          'Got API response.'
        );
        return res;
      },
    });
    const sdk = api.getSdk(async <R, V>(query: string, vars: V) => {
      try {
        return await client.rawRequest<R, V>(query, vars);
      } catch (err) {
        assertCause(err instanceof ClientError, err);
        throw clientErrors.apiRequestFailed(err);
      }
    });
    const hubEndpoint = strippingTrailingSlashes(
      opts?.hubEndpoint
        ? '' + opts.hubEndpoint
        : process.env.OPVIOUS_HUB_ENDPOINT ?? defaultEndpoint('hub', domain)
    );

    logger.debug('Created new client.');
    return new OpviousClient(tel, apiEndpoint, hubEndpoint, sdk);
  }

  /** Fetches the currently active member. */
  async fetchMember(): Promise<api.FetchedMemberFragment> {
    const res = await this.sdk.FetchMember();
    return resultData(res).me;
  }

  /** Lists all available authorizations. */
  async listAuthorizations(): Promise<
    ReadonlyArray<api.ListedAuthorizationFragment>
  > {
    const res = await this.sdk.ListAuthorizations();
    return resultData(res).me.authorizations;
  }

  /** Creates a new access token for an authorization with the given name. */
  async generateAccessToken(
    input: api.GenerateAuthorizationInput
  ): Promise<string> {
    const res = await this.sdk.GenerateAuthorization({input});
    return resultData(res).generateAuthorization.token;
  }

  /** Revokes an authorization from its name, returning true if one existed. */
  async revokeAuthorization(name: string): Promise<boolean> {
    const res = await this.sdk.RevokeAuthorization({name});
    return resultData(res).revokeAuthorization;
  }

  /** Parses and validates a specification's sources. */
  async parseSources(...sources: string[]): Promise<api.ParseSourcesOutput> {
    const res = await this.sdk.ParseSources({sources});
    return resultData(res).parseSources;
  }

  /** Adds a new specification. */
  async registerSpecification(
    input: api.RegisterSpecificationInput
  ): Promise<api.RegisteredSpecificationFragment> {
    const res = await this.sdk.RegisterSpecification({input});
    return resultData(res).registerSpecification;
  }

  /** Updates a formulation's metadata. */
  async updateFormulation(
    input: api.UpdateFormulationInput
  ): Promise<api.UpdatedFormulationFragment> {
    const res = await this.sdk.UpdateFormulation({input});
    return resultData(res).updateFormulation;
  }

  /** Fetches a formulation's outline. */
  async fetchOutline(
    formulationName: string,
    tagName?: string
  ): Promise<MarkPresent<api.FetchedOutlineFormulationFragment, 'tag'>> {
    const res = await this.sdk.FetchOutline({
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
    vars: api.PaginateFormulationsQueryVariables
  ): Promise<Paginated<api.PaginatedFormulationFragment>> {
    const res = await this.sdk.PaginateFormulations(vars);
    const forms = resultData(res).formulations;
    return {
      info: forms.pageInfo,
      totalCount: forms.totalCount,
      nodes: forms.edges.map((e) => e.node),
    };
  }

  /** Deletes a formulation, returning true if a formulation was deleted. */
  async deleteFormulation(name: string): Promise<boolean> {
    const res = await this.sdk.DeleteFormulation({name});
    return resultData(res).deleteFormulation.specificationCount > 0;
  }

  /**
   * Makes a formulation's tag publicly accessible via a unique URL. This can be
   * disabled via `unshareFormulation`.
   */
  async shareFormulation(
    input: api.StartSharingFormulationInput
  ): Promise<MarkPresent<api.SharedSpecificationTagFragment, 'sharedVia'>> {
    const res = await this.sdk.StartSharingFormulation({input});
    const tag = resultData(res).startSharingFormulation;
    return {...tag, sharedVia: check.isPresent(tag.sharedVia)};
  }

  /**
   * Makes a formulation's tag(s) private. If not tags are specified, all the
   * formulations tags will be set to private.
   */
  async unshareFormulation(
    input: api.StopSharingFormulationInput
  ): Promise<api.UnsharedFormulationFragment> {
    const res = await this.sdk.StopSharingFormulation({input});
    return resultData(res).stopSharingFormulation;
  }

  /** Paginates available attempts. */
  async paginateAttempts(
    vars: api.PaginateAttemptsQueryVariables
  ): Promise<Paginated<api.PaginatedAttemptFragment>> {
    const res = await this.sdk.PaginateAttempts(vars);
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
  async startAttempt(
    input: api.AttemptInput
  ): Promise<api.StartedAttemptFragment> {
    const res = await this.sdk.StartAttempt({input});
    return resultData(res).startAttempt;
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
  async cancelAttempt(uuid: Uuid): Promise<api.CancelledAttemptFragment> {
    const res = await this.sdk.CancelAttempt({uuid});
    return resultData(res).cancelAttempt;
  }

  /** Fetches an attempt from its UUID. */
  async fetchAttempt(
    uuid: Uuid
  ): Promise<api.FetchedAttemptFragment | undefined> {
    const res = await this.sdk.FetchAttempt({uuid});
    return resultData(res).attempt;
  }

  /** Paginates an attempt's notifications. */
  async paginateAttemptNotifications(
    vars: api.PaginateAttemptNotificationsQueryVariables
  ): Promise<Paginated<api.FullAttemptNotificationFragment>> {
    const res = await this.sdk.PaginateAttemptNotifications(vars);
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
  async fetchAttemptInputs(
    uuid: Uuid
  ): Promise<api.FetchedAttemptInputsFragment | undefined> {
    const res = await this.sdk.FetchAttemptInputs({uuid});
    const {attempt} = resultData(res);
    if (!attempt) {
      throw clientErrors.unknownAttempt(uuid);
    }
    return attempt;
  }

  /**
   * Fetches an attempt's outputs from its UUID. This method will returned
   * `undefined` if the attempt is not feasible (e.api. still pending).
   * */
  async fetchAttemptOutputs(
    uuid: Uuid
  ): Promise<api.FetchedAttemptOutputsFragment | undefined> {
    const res = await this.sdk.FetchAttemptOutputs({uuid});
    const {attempt} = resultData(res);
    if (!attempt) {
      throw clientErrors.unknownAttempt(uuid);
    }
    const {outcome} = attempt;
    return outcome?.__typename === 'FeasibleOutcome' ? outcome : undefined;
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
    return {
      apiUrl: new URL(this.apiEndpoint + `/sharing/blueprints/${slug}`),
      hubUrl: new URL(this.hubEndpoint + `/blueprints/${slug}`),
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

const ENCODING_HEADER = 'content-encoding';

const BROTLI_QUALITY = 4;

const COMPRESSION_THRESHOLD = 2 ** 16; // 64 kiB
