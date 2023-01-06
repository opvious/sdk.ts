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

import {appTelemetry} from '@opvious/stl-bootstrap';
import {errorFactories} from '@opvious/stl-errors';
import {enclosingPackageInfo} from '@opvious/stl-telemetry';
import humanizeDuration from 'humanize-duration';
import os from 'os';
import path from 'path';

export const [errors, codes] = errorFactories({
  definitions: {
    setupFailed: {},
    actionFailed: {},
    commandAborted: {},
  },
});

export const COMMAND_NAME = 'opvious';

export const packageInfo = enclosingPackageInfo(__dirname);

export function isCommanderError(err: unknown): boolean {
  const code = (err as any)?.code;
  return typeof code == 'string' && code.startsWith('commander');
}

export function humanizeMillis(millis: number): string {
  return Math.abs(millis) < 1_000
    ? 'less than a second'
    : humanizeDuration(millis, {largest: 1, round: true});
}

export function logPath(): string {
  return path.join(os.tmpdir(), COMMAND_NAME + '.log');
}

export const telemetry = appTelemetry(packageInfo, {
  loggerOptions: {
    destination: logPath(),
    redact: ['data.req.headers.authorization'],
    base: {pid: process.pid},
  },
});
