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
import {LocalPath} from '@opvious/stl-utils/files';
import {readFile} from 'fs/promises';
import jp from 'jsonpath';
import YAML from 'yaml';
import {assertValue} from 'yasdk-openapi';

import {schemaEnforcer} from './common.js';

const validators = schemaEnforcer.validators({names: ['SolveCandidate']});

export async function loadSolveCandidate(
  lp: LocalPath,
  opts?: {
    readonly jsonPath?: string;
  }
): Promise<api.Schema<'SolveCandidate'>> {
  const str = await readFile(lp, 'utf8');
  return parseSolveCandidate(str, opts);
}

export function parseSolveCandidate(
  str: string,
  opts?: {
    readonly jsonPath?: string;
  }
): api.Schema<'SolveCandidate'> {
  let data = YAML.parse(str);
  if (opts?.jsonPath) {
    data = jp.value(data, opts?.jsonPath);
  }
  assertValue(validators.isSolveCandidate, data);
  return data;
}
