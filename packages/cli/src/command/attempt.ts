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

import {Command} from 'commander';
import Table from 'easy-table';
import {createWriteStream} from 'fs';
import {DateTime} from 'luxon';
import {loadSolveCandidate} from 'opvious';
import {pipeline as streamPipeline} from 'stream/promises';

import {humanizeMillis} from '../common.js';
import {display} from '../io.js';
import {contextualAction, newCommand} from './common.js';

export function attemptCommand(): Command {
  return newCommand()
    .command('attempt')
    .description('attempt management commands')
    .addCommand(listAttemptsCommand())
    .addCommand(runAttemptCommand())
    .addCommand(cancelAttemptCommand())
    .addCommand(fetchAttemptInstructions())
    .addCommand(listAttemptNotificationsCommand());
}

function runAttemptCommand(): Command {
  return newCommand()
    .command('run')
    .description('start a new queued solve attempt')
    .argument('<path>', 'path to candidate data')
    .option('-j, --json-path <path>', 'JSONPath to nested data')
    .option('-d, --detach', 'do not wait for the attempt to complete')
    .action(
      contextualAction(async function (lp, opts) {
        const {client, spinner} = this;
        spinner.start('Parsing candidate...');
        const candidate = await loadSolveCandidate(lp, {
          jsonPath: opts.jsonPath,
        });
        spinner.succeed('Parsed candidate.').start('Starting attempt...');
        const {uuid} = await client.startAttempt({candidate});
        spinner.succeed(`Started attempt. [uuid=${uuid}]`);
        if (opts.detach) {
          return;
        }
        spinner.start('Solving...');
        await new Promise<void>((ok, fail) => {
          client
            .trackAttempt(uuid)
            .on('error', fail)
            .on('notification', (notif) => {
              spinner.text =
                `Solving... [gap=${percent(notif.relativeGap)}, ` +
                `cuts=${notif.cutCount}, iters=${notif.lpIterationCount}]`;
            })
            .on('feasible', (outcome) => {
              const details = [`optimal=${outcome.isOptimal}`];
              if (outcome.objectiveValue != null) {
                details.push(`objective=${outcome.objectiveValue}`);
              }
              spinner.succeed(`Problem solved. [${details.join(', ')}]\n`);
              ok();
            })
            .on('infeasible', () => {
              spinner.warn('Problem is infeasible.\n');
              ok();
            })
            .on('unbounded', () => {
              spinner.warn('Problem is unbounded.\n');
              ok();
            });
        });
      })
    );
}

function cancelAttemptCommand(): Command {
  return newCommand()
    .command('cancel <uuid>')
    .description('cancel a pending attempt')
    .action(
      contextualAction(async function (uuid) {
        const {client, spinner} = this;
        spinner.start('Cancelling attempt...');
        await client.cancelAttempt(uuid);
        spinner.succeed('Cancelled attempt.');
      })
    );
}

function fetchAttemptInstructions(): Command {
  return newCommand()
    .command('instructions <uuid>')
    .description('download the attempt\'s underlying instructions')
    .option('-o, --output <path>', 'output path (default: stdout)')
    .action(
      contextualAction(async function (uuid, opts) {
        const {client, spinner} = this;
        const out = opts.output
          ? createWriteStream(opts.output)
          : process.stdout;
        spinner.start('Downloading instructions...');
        const readable = client.fetchAttemptInstructions(uuid);
        await streamPipeline(readable, out);
        spinner.succeed('Downloaded instructions.');
      })
    );
}

const PAGE_LIMIT = 25;

function listAttemptsCommand(): Command {
  return newCommand()
    .command('list')
    .description('list attempts')
    .option('-l, --limit <limit>', 'maximum number of results', '' + PAGE_LIMIT)
    .action(
      contextualAction(async function (opts) {
        const {client, spinner} = this;
        spinner.start('Fetching attempts...');
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

function listAttemptNotificationsCommand(): Command {
  return newCommand()
    .command('notifications <uuid>')
    .description('list attempt notificationss')
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
