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

/** Returns the input string with any trailing slashes removed. */
export function strippingTrailingSlashes(arg: string): string {
  return arg.replace(/\/+$/, '');
}

/**
 * Marks properties in a type as present (required and non-nullable). The
 * `readonly`-ness of properties is preserved.
 */
export type MarkPresent<O extends object, F extends keyof O> = Omit<O, F> & {
  // We don't add readonly here because it would cause writable properties to
  // become readonly. The default behavior works as expected: readonly
  // properties remain readonly.
  [K in F]-?: NonNullable<O[K]>;
};
