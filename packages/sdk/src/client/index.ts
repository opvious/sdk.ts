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
import {assert, assertCause, check} from '@opvious/stl-errors';
import {noopTelemetry, Telemetry} from '@opvious/stl-telemetry';
import {withEmitter, withTypedEmitter} from '@opvious/stl-utils/events';
import {ifPresent} from '@opvious/stl-utils/functions';
import {MarkPresent} from '@opvious/stl-utils/objects';
import backoff from 'backoff';
import jsonSeq from 'json-text-sequence';
import fetch, {FetchError, Response} from 'node-fetch';
import stream from 'stream';
import {pipeline as streamPipeline} from 'stream/promises';
import {setTimeout} from 'timers/promises';

import {packageInfo, strippingTrailingSlashes} from '../common.js';
import {SolveTracker, SolveTrackerListeners} from '../solves.js';
import {
  assertHasCode,
  clientErrors,
  jsonBrotliEncoder,
  okData,
  okResultData,
  Paginated,
  QueuedSolveListeners,
  QueuedSolveTracker,
  Uuid,
} from './common.js';

export {Paginated, QueuedSolveListeners, QueuedSolveTracker} from './common.js';

/** Opvious API client. */
export class OpviousClient {
  private constructor(
    private readonly telemetry: Telemetry,
    /** Whether the client was created with an API token. */
    readonly authenticated: boolean,
    /** Base API endpoint. */
    readonly apiEndpoint: string,
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
    const auth = opts?.token ?? process.env.OPVIOUS_TOKEN;
    if (auth) {
      headers.authorization = auth.includes(' ')
        ? auth
        : auth.includes(':')
        ? `Basic ${Buffer.from(auth).toString('base64')}`
        : `Bearer ${auth}`;
    }

    const address = strippingTrailingSlashes(
      (opts?.endpoint ?? process.env.OPVIOUS_ENDPOINT) || DEFAULT_ENDPOINT
    );

    const retryCutoff = Date.now() + (opts?.maxRetryDelayMillis ?? 2_500);
    const sdk = api.createSdk<typeof fetch>({
      address,
      headers,
      fetch: async (url, init): Promise<Response> => {
        otel.propagation.inject(otel.context.active(), init.headers);
        logger.debug({data: {req: init}}, 'Sending API request...');

        let res;
        do {
          try {
            res = await fetch(url, init);
          } catch (err) {
            assertCause(err instanceof FetchError, err);
            throw clientErrors.fetchFailed(err);
          }
          const headers = Object.fromEntries(res.headers);
          logger.debug(
            {data: {res: {status: res.status, headers}}},
            'Received API response.'
          );
          const retryAfter = ifPresent(
            res.headers.get('retry-after') || undefined,
            (d) => +new Date(d) + 100
          );
          if (res.status !== 429 || !retryAfter || retryAfter > retryCutoff) {
            break;
          }
          const ms = retryAfter - Date.now();
          logger.info('Retrying throttled API request in %sms...', ms);
          await setTimeout(ms);
        } while (true); // eslint-disable-line no-constant-condition

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
    return new OpviousClient(tel, !!auth, address, sdk, graphqlSdk);
  }

  // Solving

  /** Solves an optimization model. */
  runSolve(args: {readonly problem: api.Schema<'Problem'>}): SolveTracker {
    const {problem} = args;
    return withTypedEmitter<SolveTrackerListeners>(async (ee) => {
      const res = await this.sdk.solve({
        body: {problem},
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
  formatProblem(args: {
    readonly problem: api.Schema<'Problem'>;
  }): stream.Readable {
    const {problem} = args;
    return withEmitter(new stream.PassThrough(), async (pt) => {
      const res = await this.sdk.formatProblem({
        body: {problem},
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
      body: {sources: args.sources, outline: !!args.includeOutline},
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
  async queueSolve(args: {
    readonly problem: api.Schema<'Problem'>;
  }): Promise<api.ResponseData<'queueSolve', 200>> {
    const {problem} = args;
    const res = await this.sdk.queueSolve({body: {problem}});
    return okData(res);
  }

  /**
   * Tracks a queued solve until its outcome is decided, emitting it as
   * `'outcome'`. `'notification'` events will periodically be emitted
   * containing the attempt's latest progress. If the attempt faile , the event
   * emitter will emit an error.
   */
  trackSolve(uuid: Uuid): QueuedSolveTracker {
    return withTypedEmitter<QueuedSolveListeners>((ee) => {
      const xb = backoff.exponential();
      xb.on('ready', () => {
        this.graphqlSdk
          .PollQueuedSolve({uuid})
          .then((res) => {
            const {queuedSolve} = okResultData(res);
            assert(queuedSolve, 'Unknown solve');
            const {failure, outcome} = queuedSolve;
            if (failure != null) {
              ee.emit('failure', failure);
              return;
            }
            if (outcome == null) {
              const notif = queuedSolve.notifications.edges[0]?.node;
              if (notif) {
                ee.emit('notification', notif);
              }
              xb.backoff();
              return;
            }
            ee.emit('outcome', outcome);
          })
          .catch((err) => {
            ee.emit('error', err);
          });
      }).backoff();
    });
  }

  /**
   * Convenience method which resolves when the attempt is solved. Consider
   * using `trackSolve` to get access to progress notifications and other
   * statuses.
   */
  async waitForOutcome(uuid: Uuid): Promise<api.Schema<'SolveOutcome'>> {
    return new Promise((ok, fail) => {
      this.trackSolve(uuid).on('error', fail).on('outcome', ok);
    });
  }

  /** Cancels a pending queued solve. */
  async cancelSolve(uuid: Uuid): Promise<boolean> {
    const res = await this.graphqlSdk.CancelQueuedSolve({uuid});
    return okResultData(res).cancelQueuedSolve;
  }

  /** Fetches a queued solve from its UUID. */
  async fetchSolve(
    uuid: Uuid
  ): Promise<api.graphqlTypes.FetchedQueuedSolveFragment | undefined> {
    const res = await this.graphqlSdk.FetchQueuedSolve({uuid});
    return okResultData(res).queuedSolve;
  }

  /** Paginates a queued solve's notifications. */
  async paginateSolveNotifications(
    vars: api.graphqlTypes.PaginateQueuedSolveNotificationsQueryVariables
  ): Promise<Paginated<api.graphqlTypes.FullSolveNotificationFragment>> {
    const res = await this.graphqlSdk.PaginateQueuedSolveNotifications(vars);
    const notifs = okResultData(res).queuedSolve?.notifications;
    if (!notifs) {
      throw clientErrors.unknownSolve(vars.uuid);
    }
    return {
      info: notifs.pageInfo,
      totalCount: notifs.totalCount,
      nodes: notifs.edges.map((e) => e.node),
    };
  }

  /** Fetches an attempt's inputs from its UUID. */
  async fetchSolveInputs(uuid: Uuid): Promise<api.Schema<'SolveInputs'>> {
    const res = await this.sdk.getQueuedSolveInputs({params: {uuid}});
    switch (res.code) {
      case 200:
        return res.data;
      case 404:
        throw clientErrors.unknownSolve(uuid);
      default:
        throw clientErrors.unexpectedResponseStatus(res.raw, res.data);
    }
  }

  /**
   * Fetches an attempt's outputs from its UUID. This method will returned
   * `undefined` if the attempt was not feasible.
   * */
  async fetchSolveOutputs(
    uuid: Uuid
  ): Promise<api.Schema<'SolveOutputs'> | undefined> {
    const res = await this.sdk.getQueuedSolveOutputs({params: {uuid}});
    switch (res.code) {
      case 200:
        return res.data;
      case 404:
        throw clientErrors.unknownSolve(uuid);
      case 409:
        return undefined;
      default:
        throw clientErrors.unexpectedResponseStatus(res.raw, res.data);
    }
  }
}

export interface OpviousClientOptions {
  /**
   * API authorization header or access token, defaulting to
   * `process.env.OPVIOUS_TOKEN`.
   */
  readonly token?: string;

  /**
   * Base API endpoint URL. If `undefined`, uses `process.env.OPVIOUS_ENDPOINT`
   * if set, and falls back to the default endpoint otherwise. Setting this to
   * `false` will always use the default endpoint.
   */
  readonly endpoint?: string | URL | false;

  /** Telemetry instance used for logging, etc. */
  readonly telemetry?: Telemetry;

  /**
   * Maximum number of milliseconds to wait for when retrying rate-limited
   * requests. Defaults to 2_500.
   */
  readonly maxRetryDelayMillis?: number;
}

const DEFAULT_ENDPOINT = 'https://api.cloud.opvious.io';
