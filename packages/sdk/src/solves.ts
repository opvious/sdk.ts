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
import {EventConsumer} from '@opvious/stl-utils/events';
import {PathLike} from '@opvious/stl-utils/files';
import {assertCompatible} from 'abaca-openapi';
import {readFile} from 'fs/promises';
import jp from 'jsonpath';
import YAML from 'yaml';

import {compatibilityPredicates} from './common.js';

export async function loadProblem(
  lp: PathLike,
  opts?: {
    readonly jsonPath?: string;
  }
): Promise<api.Schema<'Problem'>> {
  const str = await readFile(lp, 'utf8');
  return parseProblem(str, opts);
}

export function parseProblem(
  str: string,
  opts?: {
    readonly jsonPath?: string;
  }
): api.Schema<'Problem'> {
  let data = YAML.parse(str);
  if (opts?.jsonPath) {
    data = jp.value(data, opts?.jsonPath);
  }
  const {isProblem} = compatibilityPredicates();
  assertCompatible(data, isProblem);
  return data;
}

export interface SolveTrackerListeners {
  reified(summary: api.Schema<'ProblemSummary'>): void;

  solving(progress: api.Schema<'SolveProgress'>): void;

  solved(
    outcome: api.Schema<'SolveOutcome'>,
    outputs?: api.Schema<'SolveOutputs'>
  ): void;
}

export type SolveTracker = EventConsumer<SolveTrackerListeners>;
