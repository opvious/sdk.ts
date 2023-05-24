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
import {withEmitter, withTypedEmitter} from '@opvious/stl-utils/events';
import {MarkPresent} from '@opvious/stl-utils/objects';
import backoff from 'backoff';
import jsonSeq from 'json-text-sequence';
import fetch, {FetchError, Response} from 'node-fetch';
import stream from 'stream';
import {pipeline as streamPipeline} from 'stream/promises';

import {packageInfo, strippingTrailingSlashes} from '../common.js';
import {SolveTracker, SolveTrackerListeners} from '../solves.js';
import {
  assertHasCode,
  AttemptTracker,
  AttemptTrackerListeners,
  BlueprintUrls,
  clientErrors,
  FeasibleOutcomeFragment,
  jsonBrotliEncoder,
  okData,
  okResultData,
  Paginated,
  Uuid,
} from './common.js';

export {
  AttemptTracker,
  AttemptTrackerListeners,
  BlueprintUrls,
  FeasibleOutcomeFragment,
  Paginated,
} from './common.js';

/** Opvious API client. */
export class OpviousClient {
  private constructor(
    private readonly telemetry: Telemetry,
    /** Whether the client was created with an API token. */
    readonly authenticated: boolean,
    /** Base endpoint to the GraphQL API. */
    readonly apiEndpoint: string,
    /** Base optimization hub endpoint. */
    readonly hubEndpoint: string,
    private readonly sdk: api.Sdk<typeof fetch>,
    private readonly graphqlSdk: api.GraphqlSdk<typeof fetch>
  ) {}

  /** Creates a new client. */
  static create(opts?: OpviousClientOptions): OpviousClient {
    const tel = opts?.telemetry?.via(packageInfo) ?? noopTelemetry();
    const {logger} = tel;

    const headers: Record<string, string> = {
      'accept-encoding': 'br;q=1.0, gzip;q=0.5, *;q=0.1',
      'opvious-client': `TypeScript SDK v${packageInfo.version}`,
    };
    const auth = opts?.authorization ?? process.env.OPVIOUS_TOKEN;
    if (auth) {
      headers.authorization = auth.includes(' ') ? auth : 'Bearer ' + auth;
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
      headers,
      fetch: async (url, init): Promise<Response> => {
        otel.propagation.inject(otel.context.active(), init.headers);
        logger.debug({data: {req: init}}, 'Sending API request...');
        let res;
        try {
          res = await fetch(url, init);
        } catch (err) {
          assertCause(err instanceof FetchError, err);
          throw clientErrors.fetchFailed(err);
        }
        logger.debug(
          {
            data: {
              res: {
                status: res.status,
                headers: Object.fromEntries(res.headers),
              },
            },
          },
          'Received API response.'
        );
        return res;
      },
      decoders: {
        'application/json-seq': (res) => {
          const parser = new jsonSeq.Parser();
          res.body!.pipe(parser);
          return parser;
        },
      },
      encoders: {
        'application/json': jsonBrotliEncoder(logger),
      },
    });
    const graphqlSdk = api.createGraphqlSdk(sdk);

    logger.debug('Created new client.');
    return new OpviousClient(
      tel,
      !!auth,
      apiEndpoint,
      hubEndpoint,
      sdk,
      graphqlSdk
    );
  }

  // Solving

  /** Solves an optimization model. */
  runSolve(args: {
    readonly candidate: api.Schema<'SolveCandidate'>;
  }): SolveTracker {
    const {candidate} = args;
    return withTypedEmitter<SolveTrackerListeners>(async (ee) => {
      const res = await this.sdk.runSolve({
        body: {candidate},
        headers: {accept: 'application/json-seq, text/*'},
      });
      const iter = okData(res);
      for await (const data of iter) {
        switch (data.kind) {
          case 'error':
            ee.emit('error', new Error(data.error.message));
            break;
          case 'reified':
            ee.emit('reified', data.summary);
            break;
          case 'solving':
            ee.emit('solving', data.progress);
            break;
          case 'solved':
            ee.emit('solved', data.outcome, data.outputs);
            break;
        }
      }
    });
  }

  /** Returns an optimization model's underlying instructions. */
  inspectSolveInstructions(args: {
    readonly candidate: api.Schema<'SolveCandidate'>;
  }): stream.Readable {
    const {candidate} = args;
    return withEmitter(new stream.PassThrough(), async (pt) => {
      const res = await this.sdk.inspectSolveInstructions({
        body: {candidate},
        headers: {accept: 'text/plain'},
        decoder: (res) => {
          if (res.status !== 200) {
            return res.text();
          }
          return ''; // Do not consume the body.
        },
      });
      assertHasCode(res, 200);
      assert(res.raw.body, 'Missing body');
      await streamPipeline(res.raw.body, pt);
    });
  }

  // Account management

  /** Fetches the currently active member. */
  async fetchMember(): Promise<api.graphqlTypes.FetchedMemberFragment> {
    const res = await this.graphqlSdk.FetchMember();
    return okResultData(res).me;
  }

  /** Lists all available authorizations. */
  async listAuthorizations(): Promise<
    ReadonlyArray<api.graphqlTypes.ListedAuthorizationFragment>
  > {
    const res = await this.graphqlSdk.ListAuthorizations();
    return okResultData(res).me.authorizations;
  }

  /** Creates a new access token for an authorization with the given name. */
  async generateAccessToken(
    input: api.graphqlTypes.GenerateAuthorizationInput
  ): Promise<string> {
    const res = await this.graphqlSdk.GenerateAuthorization({input});
    return okResultData(res).generateAuthorization.token;
  }

  /** Revokes an authorization from its name, returning true if one existed. */
  async revokeAuthorization(name: string): Promise<boolean> {
    const res = await this.graphqlSdk.RevokeAuthorization({name});
    return okResultData(res).revokeAuthorization;
  }

  // Formulations

  /** Parses and validates a formulation's sources. */
  async parseSources(args: {
    readonly sources: ReadonlyArray<string>;
    readonly includeOutline?: boolean;
  }): Promise<api.ResponseData<'parseSources', 200>> {
    const res = await this.sdk.parseSources({
      body: {sources: args.sources, outline: args.includeOutline},
    });
    return okData(res);
  }

  /** Adds a new specification. */
  async registerSpecification(
    input: api.graphqlTypes.RegisterSpecificationInput
  ): Promise<api.graphqlTypes.RegisteredSpecificationFragment> {
    const res = await this.graphqlSdk.RegisterSpecification({input});
    return okResultData(res).registerSpecification;
  }

  /** Updates a formulation's metadata. */
  async updateFormulation(
    input: api.graphqlTypes.UpdateFormulationInput
  ): Promise<api.graphqlTypes.UpdatedFormulationFragment> {
    const res = await this.graphqlSdk.UpdateFormulation({input});
    return okResultData(res).updateFormulation;
  }

  /** Fetches a formulation's outline. */
  async fetchFormulationOutline(
    formulationName: string,
    tagName?: string
  ): Promise<
    MarkPresent<api.graphqlTypes.FetchedOutlineFormulationFragment, 'tag'>
  > {
    const res = await this.graphqlSdk.FetchOutline({
      formulationName,
      tagName,
    });
    const form = okResultData(res).formulation;
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
    const forms = okResultData(res).formulations;
    return {
      info: forms.pageInfo,
      totalCount: forms.totalCount,
      nodes: forms.edges.map((e) => e.node),
    };
  }

  /** Paginates available specification tags for a formulation. */
  async paginateFormulationTags(
    vars: api.graphqlTypes.PaginateFormulationTagsQueryVariables
  ): Promise<Paginated<api.graphqlTypes.PaginatedFormulationTagFragment>> {
    const res = await this.graphqlSdk.PaginateFormulationTags(vars);
    const tags = okResultData(res).formulation?.tags;
    if (!tags) {
      throw clientErrors.unknownFormulation(vars.formulationName);
    }
    return {
      info: tags.pageInfo,
      totalCount: tags.totalCount,
      nodes: tags.edges.map((e) => e.node),
    };
  }

  /** Deletes a formulation, returning true if a formulation was deleted. */
  async deleteFormulation(name: string): Promise<boolean> {
    const res = await this.graphqlSdk.DeleteFormulation({name});
    return okResultData(res).deleteFormulation.specificationCount > 0;
  }

  // Formulation sharing

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
    const tag = okResultData(res).startSharingFormulation;
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
    return okResultData(res).stopSharingFormulation;
  }

  // Attempts

  /** Paginates available attempts. */
  async paginateAttempts(
    vars: api.graphqlTypes.PaginateAttemptsQueryVariables
  ): Promise<Paginated<api.graphqlTypes.PaginatedAttemptFragment>> {
    const res = await this.graphqlSdk.PaginateAttempts(vars);
    const forms = okResultData(res).attempts;
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
    readonly candidate: api.Schema<'SolveCandidate'>;
  }): Promise<api.ResponseData<'startAttempt', 200>> {
    const {candidate} = args;
    const res = await this.sdk.startAttempt({body: {candidate}});
    return okData(res);
  }

  /**
   * Tracks an attempt until its outcome is decided, emitting it as `'outcome'`.
   * `'notification'` events will periodically be emitted containing the
   * attempt's latest progress. If the attempt failed (error, infeasible,
   * unbounded), the event emitter will emit an error.
   */
  trackAttempt(uuid: Uuid): AttemptTracker {
    return withTypedEmitter<AttemptTrackerListeners>((ee) => {
      const xb = backoff.exponential();
      xb.on('ready', () => {
        this.graphqlSdk
          .PollAttempt({uuid})
          .then((res) => {
            const {attempt} = okResultData(res);
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
                throw clientErrors.attemptErrored(
                  uuid,
                  attempt.outcome.failure
                );
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
    });
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
    return okResultData(res).cancelAttempt;
  }

  /** Fetches an attempt from its UUID. */
  async fetchAttempt(
    uuid: Uuid
  ): Promise<api.graphqlTypes.FetchedAttemptFragment | undefined> {
    const res = await this.graphqlSdk.FetchAttempt({uuid});
    return okResultData(res).attempt;
  }

  /** Paginates an attempt's notifications. */
  async paginateAttemptNotifications(
    vars: api.graphqlTypes.PaginateAttemptNotificationsQueryVariables
  ): Promise<Paginated<api.graphqlTypes.FullAttemptNotificationFragment>> {
    const res = await this.graphqlSdk.PaginateAttemptNotifications(vars);
    const notifs = okResultData(res).attempt?.notifications;
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
  async fetchAttemptInputs(uuid: Uuid): Promise<api.Schema<'SolveInputs'>> {
    const res = await this.sdk.getAttemptInputs({
      parameters: {attemptUuid: uuid},
    });
    switch (res.code) {
      case 200:
        return res.data;
      case 404:
        throw clientErrors.unknownAttempt(uuid);
      default:
        throw clientErrors.unexpectedResponseStatus(res.raw, res.data);
    }
  }

  /** Fetches an attempt's instructions from its UUID. */
  fetchAttemptInstructions(uuid: Uuid): stream.Readable {
    return withEmitter(new stream.PassThrough(), async (pt) => {
      const res = await this.sdk.getAttemptInstructions({
        parameters: {attemptUuid: uuid},
        headers: {accept: 'text/plain'},
        decoder: (res) => {
          if (res.status !== 200) {
            return res.text();
          }
          return ''; // Do not consume the body.
        },
      });
      if (res.code === 404) {
        throw clientErrors.unknownAttempt(uuid);
      }
      assertHasCode(res, 200);
      assert(res.raw.body, 'Missing body');
      await streamPipeline(res.raw.body, pt);
    });
  }

  /**
   * Fetches an attempt's outputs from its UUID. This method will returned
   * `undefined` if the attempt was not feasible.
   * */
  async fetchAttemptOutputs(
    uuid: Uuid
  ): Promise<api.Schema<'SolveOutputs'> | undefined> {
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
        throw clientErrors.unexpectedResponseStatus(res.raw, res.data);
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
