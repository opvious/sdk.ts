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

import * as g from 'opvious-graph';

export type KeyItem = g.Scalars['KeyItem'];
export type Label = g.Scalars['Label'];

export function isIndicator(sig: g.TensorOutline): boolean {
  return sig.isIntegral && sig.lowerBound === 0 && sig.upperBound === 1;
}

const EPSILON = 1e-6;

export function isAlmost(arg: number, target: number): boolean {
  return Math.abs(arg - target) < EPSILON;
}

/** Runs a function if the argument is not null or undefined. */
export function ifPresent<V, W>(
  val: V | null | undefined,
  fn: (v: Exclude<V, null | undefined>) => W
): W | undefined {
  return val === null || val === undefined ? undefined : fn(val as any);
}
