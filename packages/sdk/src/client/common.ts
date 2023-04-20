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

import {types as graphqlTypes} from '@opvious/api/graphql';
import {check, errorFactories, errorMessage} from '@opvious/stl-errors';
import {Logger} from '@opvious/stl-telemetry';
import {EventConsumer} from '@opvious/stl-utils/events';
import * as gql from 'graphql';
import fetch, {FetchError, Response} from 'node-fetch';
import type {Encoder, ResponseCode} from 'yasdk-runtime';
import zlib from 'zlib';

export type Label = graphqlTypes.Scalars['Label'];

export type Uuid = graphqlTypes.Scalars['Uuid'];

const TRACE_HEADER = 'opvious-trace';

export const [clientErrors, clientErrorCodes] = errorFactories({
  definitions: {
    fetchFailed: (cause: FetchError) => ({
      message: 'API fetch failed: ' + cause.message,
      cause,
    }),
    unexpectedResponseStatus: (res: Response, data: unknown) => ({
      message:
        `Response${traceDetails(res.headers.get(TRACE_HEADER))} had ` +
        `unexpected status ${res.status}: ${JSON.stringify(data)}`,
      tags: {status: res.status, data},
    }),
    graphqlRequestErrored: (
      errs: ReadonlyArray<gql.GraphQLError>,
      trace: string | undefined
    ) => ({
      message:
        `GraphQL response${traceDetails(trace)} included errors: ` +
        errs.map(formatError).join(', '),
      tags: {errors: errs},
    }),
    attemptCancelled: (uuid: Uuid) => ({
      message: 'Attempt was cancelled',
      tags: {uuid},
    }),
    attemptErrored: (uuid: Uuid, failure: unknown) => ({
      message: `Attempt errored: ${errorMessage(failure)}`,
      tags: {uuid, failure},
    }),
    unknownAttempt: (uuid: Uuid) => ({
      message: `Attempt ${uuid} was not found`,
      tags: {uuid},
    }),
    unknownFormulation: (formulation: string, tag?: string) => ({
      message:
        `Formulation ${formulation} ${tag ? ` (${tag})` : ''}` +
        'was not found',
      tags: {formulation, tag},
    }),
  },
});

function traceDetails(trace?: string | null): string {
  return trace ? ` (trace '${trace}')` : '';
}

const ENCODING_HEADER = 'content-encoding';

const BROTLI_QUALITY = 4;

const COMPRESSION_THRESHOLD = 2 ** 16; // 64 kiB

export function jsonBrotliEncoder(log: Logger): Encoder<unknown, typeof fetch> {
  return (body, ctx) => {
    const str = JSON.stringify(body);
    const len = str.length;
    if (len <= COMPRESSION_THRESHOLD) {
      log.debug({data: {len}}, 'Sending uncompressed body...');
      return str;
    }
    ctx.headers[ENCODING_HEADER] = 'br';
    const compressed = zlib.createBrotliCompress({
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
      },
    });
    process.nextTick(() => {
      compressed.end(str);
    });
    log.debug({data: {len}}, 'Sending compressed body...');
    return compressed;
  };
}

interface HasCode<C extends ResponseCode = ResponseCode> {
  readonly code: C;
  readonly data: unknown;
  readonly raw: Response;
}

export function assertHasCode<O extends HasCode, C extends ResponseCode = 200>(
  res: O,
  code: C
): void {
  if (res.code !== code) {
    throw clientErrors.unexpectedResponseStatus(res.raw, res.data);
  }
}

export function okData<O extends HasCode, C extends ResponseCode = 200>(
  res: O,
  code?: C
): (O & HasCode<C>)['data'] {
  assertHasCode(res, code ?? 200);
  return (res as any).data;
}

export function okResultData<V>(
  res: gql.ExecutionResult<V, {readonly trace?: string}>
): V {
  if (res.errors?.length) {
    throw clientErrors.graphqlRequestErrored(res.errors, res.extensions?.trace);
  }
  return check.isPresent(res.data);
}

function formatError(err: gql.GraphQLError): string {
  let msg = err.message;
  if (err.extensions) {
    const details = Object.entries(err.extensions).map(
      (e) =>
        `${e[0]}: ${typeof e[1] === 'string' ? e[1] : JSON.stringify(e[1])}`
    );
    msg += ` (${details.join(', ')})`;
  }
  return msg;
}

export interface Paginated<V> {
  readonly info: graphqlTypes.PageInfo;
  readonly totalCount: number;
  readonly nodes: ReadonlyArray<V>;
}

export type FeasibleOutcomeFragment =
  graphqlTypes.PolledAttemptOutcomeFragment & {
    readonly __typename: 'FeasibleOutcome';
  };

export interface AttemptTrackerListeners {
  /**
   * The attempt is still being solved, with current status as reported in the
   * argument notification.
   */
  notification(frag: graphqlTypes.FullAttemptNotificationFragment): void;

  /**
   * The attempt completed with the given feasible (possibly optimal) outcome.
   * Once this event is emitted, no more events will be emitted on this tracker
   * instance.
   */
  feasible(frag: FeasibleOutcomeFragment): void;

  /**
   * The attempt completed with infeasible status. Once this event is emitted,
   * no more events will be emitted on this tracker instance.
   */
  infeasible(): void;

  /**
   * The attempt completed with unbounded status. Once this event is emitted, no
   * more events will be emitted on this tracker instance.
   */
  unbounded(): void;

  /** The attempt errored. */
  error(err: Error): void;
}

/**
 * Type-safe event-emitter used for tracking attempt progress. See the
 * associated listeners for more information.
 */
export type AttemptTracker = EventConsumer<AttemptTrackerListeners>;

export interface BlueprintUrls {
  readonly apiUrl: URL;
  readonly hubUrl: URL;
}
