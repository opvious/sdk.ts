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

import {GraphQLClient} from 'graphql-request';
import * as api from 'opvious-graph';

export type Definition = api.Scalars['Definition'];

export type Name = api.Scalars['Name'];

/** Opvious API client. */
export class OpviousClient {
  private constructor(private readonly sdk: api.Sdk) {}

  /** Creates a new client. */
  static create(opts?: OpviousClientOptions): OpviousClient {
    const token = opts?.accessToken ?? process.env.OPVIOUS_TOKEN;
    if (!token) {
      throw new Error('Missing Opvious access token');
    }
    const apiEndpoint = opts?.apiEndpoint
      ? '' + opts.apiEndpoint
      : process.env.OPVIOUS_ENDPOINT ?? api.ENDPOINT;
    const client = new GraphQLClient(apiEndpoint, {
      headers: {authorization: 'Bearer ' + token},
    });
    const sdk = api.getSdk(<R, V>(query: string, vars: V) =>
      client.rawRequest<R, V>(query, vars)
    );
    return new OpviousClient(sdk);
  }

  async extractDefinitions(source: string): Promise<ReadonlyArray<Definition>> {
    const {data} = await this.sdk.ExtractDefinitions({sources: [source]});
    const defs: any[] = [];
    for (const slice of data?.extractDefinitions.slices ?? []) {
      if (slice.__typename === 'InvalidSourceSlice') {
        throw new Error(slice.errorMessage);
      }
      defs.push(slice.definition);
    }
    return defs;
  }

  async registerSpecification(args: {
    readonly source: string;
    readonly formulationName: string;
    readonly tagNames: ReadonlyArray<Name>;
  }): Promise<void> {
    const defs = await this.extractDefinitions(args.source);
    await this.sdk.RegisterSpecification({
      input: {
        definitions: defs,
        formulationName: args.formulationName,
        tagNames: args.tagNames,
      },
    });
  }

  async updateFormulation(args: {
    readonly name: string;
    readonly displayName?: string;
    readonly description?: string;
    readonly url?: string;
  }): Promise<void> {
    await this.sdk.UpdateFormulation({
      input: {
        name: args.name,
        patch: {
          description: args.description,
          displayName: args.displayName,
          url: args.url,
        },
      },
    });
  }

  async deleteFormulation(name: string): Promise<void> {
    await this.sdk.DeleteFormulation({name});
  }
}

export interface OpviousClientOptions {
  /** API authorization token, defaulting to `process.env.OPVIOUS_TOKEN`. */
  readonly accessToken?: string;

  /**
   * GraphQL endpoint URL. If unset, uses `process.env.OPVIOUS_ENDPOINT` if set,
   * and falls back to the default production endpoint otherwise.
   */
  readonly apiEndpoint?: string | URL;
}
