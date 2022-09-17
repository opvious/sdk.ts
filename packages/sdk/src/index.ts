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

export const name = 'opvious';

const API_URL = 'https://api.opvious.io';

export class OpviousClient {
  private constructor(private readonly sdk: api.Sdk) {}

  static forToken(token: string): OpviousClient {
    const client = new GraphQLClient(API_URL, {
      headers: {authorization: 'Bearer ' + token},
    });
    const sdk = api.getSdk(<R, V>(query: string, vars: V) =>
      client.rawRequest<R, V>(query, vars)
    );
    return new OpviousClient(sdk);
  }

  async registerFormulation(
    input: api.RegisterSpecificationInput
  ): Promise<void> {
    await this.sdk.RegisterSpecification({input});
  }

  async deleteFormulation(name: string): Promise<void> {
    await this.sdk.DeleteFormulation({name});
  }
}
