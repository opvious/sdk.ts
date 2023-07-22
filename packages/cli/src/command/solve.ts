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
import {waitForEvent} from '@opvious/stl-utils/events';
import {ifPresent} from '@opvious/stl-utils/functions';
import {isUuid} from '@opvious/stl-utils/opaques';
import {Command} from 'commander';
import Table from 'easy-table';
import {createWriteStream} from 'fs';
import {writeFile} from 'fs/promises';
import {DateTime} from 'luxon';
import {loadSolveCandidate} from 'opvious';
import {pipeline as streamPipeline} from 'stream/promises';
import YAML from 'yaml';

import {humanizeMillis} from '../common.js';
import {display} from '../io.js';
import {contextualAction, newCommand} from './common.js';

export function solveCommand(): Command {
  return newCommand()
    .command('solve')
    .description('problem solving commands')
    .addCommand(runCommand())
    .addCommand(queueCommand())
    .addCommand(cancelCommand())
    .addCommand(listCommand())
    .addCommand(outputsCommand())
    .addCommand(instructionsCommand())
    .addCommand(listNotificationsCommand());
}

function runCommand(): Command {
  return newCommand()
    .command('run')
    .description('run a solve')
    .argument('<path>', 'path to candidate data')
    .option('-j, --json-path <path>', 'JSONPath to nested candidate data')
    .option('-o, --output <path>', 'output path (default: stdout)')
    .action(
      contextualAction(async function (lp, opts) {
        const {client, spinner} = this;
        spinner.start('Parsing candidate...');
        const cand = await loadSolveCandidate(lp, {jsonPath: opts.jsonPath});
        spinner
          .succeed(
            `Parsed candidate. [parameters=${cand.inputs.parameters.length}]`
          )
          .start('Solving...');
        const tracker = client
          .runSolve({candidate: cand})
          .on('solving', (p) => {
            if (p.kind === 'activity') {
              spinner.text =
                `Solving... [gap=${formatGap(p.relativeGap)}, ` +
                `cuts=${p.cutCount}, iterations=${p.lpIterationCount}]`;
            }
          });
        const [outcome, outputs] = await waitForEvent(tracker, 'solved');
        const details = [`status=${outcome.status}`];
        ifPresent(
          outcome.objectiveValue,
          (v) => void details.push(`objective=${v}`)
        );
        ifPresent(
          outcome.relativeGap,
          (g) => void details.push(`gap=${formatGap(g)}`)
        );
        spinner.succeed(`Completed solve. [${details.join(', ')}]`);
        const data = YAML.stringify(outputs);
        if (opts.output) {
          await writeFile(opts.output, data, 'utf8');
        } else {
          display(data);
        }
      })
    );
}

function formatGap(gap: api.Schema<'ExtendedFloat'> | undefined): string {
  switch (gap) {
    case undefined:
      return 'n/a';
    case 'Infinity':
      return 'inf';
    case '-Infinity':
      return '-inf';
    case 0:
      return '0';
    default:
      return `${((1_000 * +gap) | 0) / 10}%`;
  }
}

function queueCommand(): Command {
  return newCommand()
    .command('queue')
    .description('queue a solve attempt')
    .argument('<path>', 'path to candidate data')
    .option('-j, --json-path <path>', 'JSONPath to nested candidate data')
    .action(
      contextualAction(async function (lp, opts) {
        const {client, spinner} = this;
        spinner.start('Parsing candidate...');
        const cand = await loadSolveCandidate(lp, {jsonPath: opts.jsonPath});
        spinner
          .succeed(
            `Parsed candidate. [parameters=${cand.inputs.parameters.length}]`
          )
          .start('Solving...');
        const {uuid} = await client.startAttempt({candidate: cand});
        spinner.succeed(`Queued solve attempt. [uuid=${uuid}]`);
      })
    );
}
function outputsCommand(): Command {
  return newCommand()
    .command('outputs')
    .description('download a feasible queued solve\'s outputs')
    .argument('<uuid>', 'attempt UUID')
    .option('-o, --output <path>', 'output path (default: stdout)')
    .action(
      contextualAction(async function (arg, opts) {
        const {client, spinner} = this;
        spinner.start('Downloading outputs...');
        const outputs = await client.fetchAttemptOutputs(arg);
        if (outputs == null) {
          spinner.warn('No outputs found');
          return;
        }
        const data = YAML.stringify(outputs);
        if (opts.output) {
          await writeFile(opts.output, data, 'utf8');
          spinner.succeed('Downloaded outputs.');
        } else {
          spinner.stop().clear();
          display(data);
        }
      })
    );
}

function instructionsCommand(): Command {
  return newCommand()
    .command('instructions')
    .description('view a solve\'s underlying instructions')
    .argument('<path|uuid>', 'path to candidate data or queued solve UUID')
    .option(
      '-j, --json-path <path>',
      'JSONPath to nested candidate data. only applicable with local path'
    )
    .option('-o, --output <path>', 'output path (default: stdout)')
    .action(
      contextualAction(async function (arg, opts) {
        const {client, spinner} = this;
        const out = opts.output
          ? createWriteStream(opts.output)
          : process.stdout;
        let readable;
        if (isUuid(arg)) {
          spinner.start('Fetching attempt instructions...');
          readable = client.fetchAttemptInstructions(arg);
        } else {
          spinner.start('Parsing candidate...');
          const cand = await loadSolveCandidate(arg, {jsonPath: opts.jsonPath});
          spinner
            .succeed('Parsed candidate.')
            .start('Computing instructions...');
          readable = client.inspectSolveInstructions({candidate: cand});
        }
        if (!opts.output) {
          spinner.stop().clear();
        }
        await streamPipeline(readable, out);
        if (opts.output) {
          spinner.succeed('Downloaded instructions.');
        }
      })
    );
}

function cancelCommand(): Command {
  return newCommand()
    .command('cancel <uuid>')
    .description('cancel a pending solve attempt')
    .action(
      contextualAction(async function (uuid) {
        const {client, spinner} = this;
        spinner.start('Cancelling attempt...');
        await client.cancelAttempt(uuid);
        spinner.succeed('Cancelled attempt.');
      })
    );
}

const PAGE_LIMIT = 25;

function listCommand(): Command {
  return newCommand()
    .command('list')
    .description('list solve attempts')
    .option('-l, --limit <limit>', 'maximum number of results', '' + PAGE_LIMIT)
    .action(
      contextualAction(async function (opts) {
        const {client, spinner} = this;
        spinner.start('Fetching queued solves...');
        const table = new Table();
        const limit = +opts.limit;
        let count = 0;
        let cursor: string | undefined;
        do {
          const paginated = await client.paginateAttempts({
            last: Math.min(PAGE_LIMIT, limit - count),
            before: cursor,
          });
          for (const attempt of [...paginated.nodes].reverse()) {
            const startedAt = DateTime.fromISO(attempt.startedAt);
            const endedAt = attempt.endedAt
              ? DateTime.fromISO(attempt.endedAt)
              : undefined;
            const spec = attempt.pristineSpecification;
            table.cell('uuid', attempt.uuid);
            table.cell('formulation', spec.formulation.displayName);
            table.cell('tag', attempt.specificationTagName);
            table.cell('revno', spec.revno);
            table.cell('status', attempt.status);
            table.cell('started', startedAt.toRelative());
            table.cell(
              'runtime',
              endedAt ? humanizeMillis(+endedAt.diff(startedAt)) : ''
            );
            table.newRow();
          }
          const {hasPreviousPage, startCursor} = paginated.info;
          cursor = hasPreviousPage ? startCursor : undefined;
          count += paginated.nodes.length;
          spinner.text =
            `Fetched ${count} of ${paginated.totalCount} ` + 'attempts...';
        } while (cursor && count < limit);
        spinner.succeed(`Fetched ${count} attempt(s).\n`);
        if (count) {
          display('' + table);
        }
      })
    );
}

function listNotificationsCommand(): Command {
  return newCommand()
    .command('notifications <uuid>')
    .description('list a queued solve\'s notificationss')
    .option('-l, --limit <limit>', 'maximum number of results', '' + PAGE_LIMIT)
    .action(
      contextualAction(async function (uuid, opts) {
        const {client, spinner} = this;
        spinner.start('Fetching notifications...');
        const table = new Table();
        const limit = +opts.limit;
        let count = 0;
        let cursor: string | undefined;
        do {
          const paginated = await client.paginateAttemptNotifications({
            uuid,
            last: Math.min(PAGE_LIMIT, limit - count),
            before: cursor,
          });
          for (const attempt of [...paginated.nodes].reverse()) {
            const effectiveAt = DateTime.fromISO(attempt.effectiveAt);
            table.cell('effective', effectiveAt.toRelative());
            table.cell('gap', percent(attempt.relativeGap ?? Infinity));
            table.cell('cuts', attempt.cutCount ?? '-');
            table.cell('lp_iterations', attempt.lpIterationCount ?? '-');
            table.newRow();
          }
          const {hasPreviousPage, startCursor} = paginated.info;
          cursor = hasPreviousPage ? startCursor : undefined;
          count += paginated.nodes.length;
          spinner.text =
            `Fetched ${count} of ${paginated.totalCount} ` + 'notifications...';
        } while (cursor && count < limit);
        spinner.succeed(`Fetched ${count} notification(s).\n`);
        if (count) {
          display('' + table);
        }
      })
    );
}

function percent(arg: number | string | undefined): string {
  if (typeof arg != 'number' || !isFinite(arg)) {
    return 'inf';
  }
  return ((10_000 * arg) | 0) / 100 + '%';
}
