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

import {waitForEvent} from '@opvious/stl-utils/events';
import {Command} from 'commander';
import {createWriteStream} from 'fs';
import {loadSolveCandidate} from 'opvious';
import {pipeline as streamPipeline} from 'stream/promises';

import {contextualAction, newCommand} from './common.js';

export function solveCommand(): Command {
  return newCommand()
    .command('solve')
    .description('solve commands')
    .addCommand(runCommand())
    .addCommand(inspectInstructionsCommand());
}

function runCommand(): Command {
  return newCommand()
    .command('run')
    .description('run a new solve')
    .argument('<path>', 'path to candidate')
    .option('-j, --json-path <path>', 'JSONPath to nested data')
    .action(
      contextualAction(async function (lp, opts) {
        const {client, spinner} = this;
        spinner.start('Parsing candidate...');
        const cand = await loadSolveCandidate(lp, {jsonPath: opts.jsonPath});
        spinner.succeed('Parsed candidate.').start('Starting solve...');
        const tracker = client.runSolve({candidate: cand});
        const [outcome] = await waitForEvent(tracker, 'solved');
        spinner.succeed(`Completed solve. [status=${outcome.status}]`);
        // TODO: Write outputs.
      })
    );
}

function inspectInstructionsCommand(): Command {
  return newCommand()
    .command('instructions')
    .description('download the solve\'s underlying instructions')
    .argument('<path>', 'path to candidate data')
    .option('-j, --json-path <path>', 'JSONPath to nested data')
    .option('-o, --output <path>', 'output path (default: stdout)')
    .action(
      contextualAction(async function (lp, opts) {
        const {client, spinner} = this;
        spinner.start('Parsing candidate...');
        const cand = await loadSolveCandidate(lp, {jsonPath: opts.jsonPath});
        spinner
          .succeed('Parsed candidate.')
          .start('Downloading instructions...');
        const out = opts.output
          ? createWriteStream(opts.output)
          : process.stdout;
        const readable = client.inspectSolveInstructions({candidate: cand});
        await streamPipeline(readable, out);
        spinner.succeed('Downloaded instructions.');
      })
    );
}
