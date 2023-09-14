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

import * as api from '@opvious/api';
import {
  CompatibilityPredicatesFor,
  OpenapiDocument,
  parseOpenapiDocument,
  schemaCompatibilityPredicates,
} from 'abaca-openapi';
import __inlinable from 'inlinable';

/** Package metadata. */
export const packageInfo = __inlinable((ctx) =>
  ctx.enclosing(import.meta.url).metadata()
);

/** Returns the input string with any trailing slashes removed. */
export function strippingTrailingSlashes(arg: string | URL): string {
  return ('' + arg).replace(/\/+$/, '');
}

let document: OpenapiDocument<api.Schemas> | undefined;

export function openapiDocument(): OpenapiDocument<api.Schemas> {
  if (!document) {
    document = parseOpenapiDocument(api.OPENAPI_SCHEMA);
  }
  return document;
}

let predicates: CompatibilityPredicatesFor<api.Schemas, 'Problem'> | undefined;

export function compatibilityPredicates(): CompatibilityPredicatesFor<
  api.Schemas,
  'Problem'
> {
  if (!predicates) {
    predicates = schemaCompatibilityPredicates({
      document: openapiDocument(),
      names: ['Problem'],
    });
  }
  return predicates;
}
