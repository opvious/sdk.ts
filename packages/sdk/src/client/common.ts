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

import * as api from '@opvious/api-operations';
import {check, errorFactories, errorMessage} from '@opvious/stl-errors';
import * as gql from 'graphql';
import {ClientError} from 'graphql-request';
import {TypedEmitter} from 'tiny-typed-emitter';

export type Label = api.Scalars['Label'];

export type Uuid = api.Scalars['Uuid'];

export const [clientErrors, clientErrorCodes] = errorFactories({
  definitions: {
    apiRequestFailed: (cause: ClientError) => ({
      message:
        'API request failed: ' +
        (cause.response.errors?.map(formatError).join(', ') ?? cause.message),
      cause,
      tags: {errors: cause.response.errors},
    }),
    apiResponseErrored: (errs: ReadonlyArray<gql.GraphQLError>) => ({
      message:
        'API response included errors: ' + errs.map(formatError).join(', '),
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
    missingAuthorization: 'No authorization found',
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

export function resultData<V>(res: gql.ExecutionResult<V, unknown>): V {
  if (res.errors?.length) {
    throw clientErrors.apiResponseErrored(res.errors);
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
  readonly info: api.PageInfo;
  readonly totalCount: number;
  readonly nodes: ReadonlyArray<V>;
}

export type FeasibleOutcomeFragment = api.PolledAttemptOutcomeFragment & {
  readonly __typename: 'FeasibleOutcome';
};

export interface AttemptTrackerListeners {
  /**
   * The attempt is still being solved, with current status as reported in the
   * argument notification.
   */
  notification(frag: api.FullAttemptNotificationFragment): void;

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
export type AttemptTracker = TypedEmitter<AttemptTrackerListeners>;

export interface BlueprintUrls {
  readonly apiUrl: URL;
  readonly hubUrl: URL;
}
