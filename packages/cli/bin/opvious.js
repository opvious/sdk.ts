#!/usr/bin/env node

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

import {mainCommand, telemetry} from '../lib/index.js';
import codes from '../lib/index.errors.js';

telemetry.logger.info(
  {data: {cwd: process.cwd(), argv: process.argv, execArgv: process.execArgv}},
  'Running command...',
  process.argv.join(' ')
);

mainCommand().parseAsync(process.argv).catch((err) => {
  if (err.code === codes.CommandAborted) {
    process.exitCode = err.tags?.exitCode ?? 0;
    return;
  }
  process.exitCode = 1;
  telemetry.logger.fatal({err}, 'Command failed.');
  if (!codes.has(err.code)) {
    console.error(err);
  }
});
