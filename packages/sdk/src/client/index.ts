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
import {assert, assertCause, check} from '@opvious/stl-errors';
import {noopTelemetry, Telemetry} from '@opvious/stl-telemetry';
import {MarkPresent} from '@opvious/stl-utils';
import backoff from 'backoff';
import events from 'events';
import {ClientError, GraphQLClient} from 'graphql-request';
import fetch, {Headers, RequestInfo, RequestInit, Response} from 'node-fetch';
import * as g from 'opvious-graph';
import {TypedEmitter} from 'tiny-typed-emitter';
import zlib from 'zlib';

import {packageInfo, strippingTrailingSlashes} from '../common';
import {
  AttemptTracker,
  AttemptTrackerListeners,
  BlueprintUrls,
  clientErrors,
  InvalidSourceSnippet,
  invalidSourceSnippet,
  Paginated,
  resultData,
  Uuid,
} from './common';

export {
  AttemptTracker,
  AttemptTrackerListeners,
  BlueprintUrls,
  clientErrorCodes,
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
    private readonly sdk: g.Sdk
  ) {}

  /** Creates a new client. */
  static create(opts?: OpviousClientOptions): OpviousClient {
    const tel = (opts?.telemetry ?? noopTelemetry()).via(packageInfo);
    const {logger} = tel;

    const auth = opts?.authorization ?? process.env.OPVIOUS_TOKEN;
    if (!auth) {
      throw clientErrors.missingAuthorization();
    }
    const apiEndpoint = strippingTrailingSlashes(
      opts?.apiEndpoint
        ? '' + opts.apiEndpoint
        : process.env.OPVIOUS_API_ENDPOINT ?? DefaultEndpoint.API
    );
    const client = new GraphQLClient(apiEndpoint + '/graphql', {
      errorPolicy: 'all',
      headers: {
        'accept-encoding': 'br;q=1.0, gzip;q=0.5, *;q=0.1',
        authorization: auth.includes(' ') ? auth : 'Bearer ' + auth,
        'opvious-sdk': 'TypeScript v' + packageInfo.version,
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
    const sdk = g.getSdk(async <R, V>(query: string, vars: V) => {
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
        : process.env.OPVIOUS_HUB_ENDPOINT ?? DefaultEndpoint.HUB
    );

    logger.debug('Created new client.');
    return new OpviousClient(tel, apiEndpoint, hubEndpoint, sdk);
  }

  /** Fetch currently active account information. */
  async fetchMyAccount(): Promise<g.MyAccountFragment> {
    const res = await this.sdk.FetchMyAccount();
    return resultData(res).me;
  }

  /** Lists all available authorizations. */
  async listAuthorizations(): Promise<
    ReadonlyArray<g.ListedAuthorizationFragment>
  > {
    const res = await this.sdk.ListMyAuthorizations();
    return resultData(res).me.holder.authorizations;
  }

  /** Creates a new access token for an authorization with the given name. */
  async generateAccessToken(
    input: g.GenerateAuthorizationInput
  ): Promise<string> {
    const res = await this.sdk.GenerateAuthorization({input});
    return resultData(res).generateAuthorization.token;
  }

  /** Revokes an authorization from its name, returning true if one existed. */
  async revokeAuthorization(name: string): Promise<boolean> {
    const res = await this.sdk.RevokeAuthorization({name});
    return resultData(res).revokeAuthorization;
  }

  /**
   * Extracts definitions from one or more sources. These definitions can then
   * be used to register a specification.
   */
  async extractDefinitions(
    ...sources: string[]
  ): Promise<ReadonlyArray<g.Definition>> {
    const res = await this.sdk.ExtractDefinitions({sources});
    const defs: any[] = [];
    const snips: InvalidSourceSnippet[] = [];
    for (const slice of resultData(res).extractDefinitions.slices) {
      if (slice.__typename === 'InvalidSourceSlice') {
        const src = check.isPresent(sources[slice.index]);
        snips.push(invalidSourceSnippet(slice, src));
      } else {
        defs.push(slice.definition);
      }
    }
    if (snips.length) {
      throw clientErrors.unparseableSource(snips);
    }
    return defs;
  }

  /** Validates that the definitions are valid for registration. */
  async validateDefinitions(
    defs: ReadonlyArray<g.Definition>
  ): Promise<ReadonlyArray<string>> {
    const res = await this.sdk.ValidateDefinitions({definitions: defs});
    return resultData(res).validateDefinitions.warnings ?? [];
  }

  /** Adds a new specification. */
  async registerSpecification(
    input: g.RegisterSpecificationInput
  ): Promise<g.RegisteredSpecificationFragment> {
    const res = await this.sdk.RegisterSpecification({input});
    return resultData(res).registerSpecification;
  }

  /** Updates a formulation's metadata. */
  async updateFormulation(
    input: g.UpdateFormulationInput
  ): Promise<g.UpdatedFormulationFragment> {
    const res = await this.sdk.UpdateFormulation({input});
    return resultData(res).updateFormulation;
  }

  /** Fetches a formulation's outline. */
  async fetchOutline(
    formulationName: string,
    tagName?: string
  ): Promise<MarkPresent<g.FetchedOutlineFormulationFragment, 'tag'>> {
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
    vars: g.PaginateFormulationsQueryVariables
  ): Promise<Paginated<g.PaginatedFormulationFragment>> {
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
    input: g.StartSharingFormulationInput
  ): Promise<MarkPresent<g.SharedSpecificationTagFragment, 'sharedVia'>> {
    const res = await this.sdk.StartSharingFormulation({input});
    const tag = resultData(res).startSharingFormulation;
    return {...tag, sharedVia: check.isPresent(tag.sharedVia)};
  }

  /**
   * Makes a formulation's tag(s) private. If not tags are specified, all the
   * formulations tags will be set to private.
   */
  async unshareFormulation(
    input: g.StopSharingFormulationInput
  ): Promise<g.UnsharedFormulationFragment> {
    const res = await this.sdk.StopSharingFormulation({input});
    return resultData(res).stopSharingFormulation;
  }

  /** Paginates available attempts. */
  async paginateAttempts(
    vars: g.PaginateAttemptsQueryVariables
  ): Promise<Paginated<g.PaginatedAttemptFragment>> {
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
  async startAttempt(input: g.AttemptInput): Promise<g.StartedAttemptFragment> {
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
            case 'INFEASIBLE':
              throw new Error('Infeasible attempt');
            case 'UNBOUNDED':
              throw new Error('Unbounded attempt');
          }
          const outcome = check.isPresent(attempt.outcome);
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
  async cancelAttempt(uuid: Uuid): Promise<g.CancelledAttemptFragment> {
    const res = await this.sdk.CancelAttempt({uuid});
    return resultData(res).cancelAttempt;
  }

  /** Fetches an attempt from its UUID. */
  async fetchAttempt(
    uuid: Uuid
  ): Promise<g.FetchedAttemptFragment | undefined> {
    const res = await this.sdk.FetchAttempt({uuid});
    return resultData(res).attempt;
  }

  /** Paginates an attempt's notifications. */
  async paginateAttemptNotifications(
    vars: g.PaginateAttemptNotificationsQueryVariables
  ): Promise<Paginated<g.FullAttemptNotificationFragment>> {
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
  ): Promise<g.FetchedAttemptInputsFragment | undefined> {
    const res = await this.sdk.FetchAttemptInputs({uuid});
    const {attempt} = resultData(res);
    if (!attempt) {
      throw clientErrors.unknownAttempt(uuid);
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
   * `process.env.OPVIOUS_AUTHORIZATION`.
   */
  readonly authorization?: string;

  /** Telemetry instance used for logging, etc. */
  readonly telemetry?: Telemetry;

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

const BROTLI_QUALITY = 4;

const COMPRESSION_THRESHOLD = 2 ** 16; // 64 kiB
