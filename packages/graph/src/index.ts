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
import {getSdk, Requester, Sdk} from './api.gen';

export * from './api.gen';

/** Generates a synchronous SDK, useful for example in Google Apps Scripts. */
export function getSyncSdk(requester: SyncRequester): SyncSdk {
  return getSdk(requester as any) as any;
}

export type SyncRequester = Syncify<Requester>;

export type SyncSdk = {
  readonly [K in keyof Sdk]: Syncify<Sdk[K]>;
};

type Syncify<F> = F extends (...args: infer A) => infer R
  ? R extends Promise<infer V>
    ? (...args: A) => V
    : R extends AsyncIterable<infer V>
    ? (...args: A) => Iterable<V>
    : R extends Promise<infer V1> | AsyncIterable<infer V2>
    ? (...args: A) => V1 | Iterable<V2>
    : never
  : never;
