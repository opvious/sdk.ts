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

import {ifPresent} from '@opvious/stl-utils/functions';
import {Command} from 'commander';
import Table from 'easy-table';
import {writeFile} from 'fs/promises';
import {DateTime} from 'luxon';
import YAML from 'yaml';

import {humanizeMillis} from '../common.js';
import {display} from '../io.js';
import {contextualAction, newCommand} from './common.js';

export function queueCommand(): Command {
  return newCommand()
    .command('queue')
    .description('solve queue commands')
    .addCommand(solvesCommand())
    .addCommand(cancelCommand())
    .addCommand(outputsCommand())
    .addCommand(notificationsCommand());
}

const PAGE_LIMIT = 25;

function solvesCommand(): Command {
  return newCommand()
    .command('solves')
    .description('list queued solves')
    .option('-l, --limit <limit>', 'maximum number of results', '' + PAGE_LIMIT)
    .option('-v, --verbose', 'include outcome details')
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
            filter: {operation: 'QUEUE_SOLVE'},
            last: Math.min(PAGE_LIMIT, limit - count),
            before: cursor,
          });
          for (const attempt of [...paginated.nodes].reverse()) {
            const {content} = attempt;
            if (!content) {
              continue;
            }
            table.cell('uuid', content.queuedSolveUuid);
            table.cell(
              'formulation',
              content.queuedSolveSpecification.formulation.name
            );

            const startedAt = DateTime.fromISO(attempt.startedAt);
            const endedAt = attempt.endedAt
              ? DateTime.fromISO(attempt.endedAt)
              : undefined;
            table.cell('started', startedAt.toRelative());
            table.cell(
              'runtime',
              endedAt ? humanizeMillis(+endedAt.diff(startedAt)) : ''
            );

            table.cell(
              'status',
              attempt?.errorStatus ??
                content?.queuedSolveOutcome?.status ??
                '...'
            );

            if (opts.verbose) {
              table.cell(
                'details',
                ifPresent(
                  content.queuedSolveFailure?.error,
                  (e) => e.message
                ) ??
                  ifPresent(
                    content.queuedSolveOutcome,
                    (o) => `objective=${o.objectiveValue}`
                  ) ??
                  ''
              );
            }

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

function cancelCommand(): Command {
  return newCommand()
    .command('cancel <uuid>')
    .description('cancel a pending solve attempt')
    .action(
      contextualAction(async function (uuid) {
        const {client, spinner} = this;
        spinner.start('Cancelling attempt...');
        await client.cancelSolve(uuid);
        spinner.succeed('Cancelled attempt.');
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
        const outputs = await client.fetchSolveOutputs(arg);
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

function notificationsCommand(): Command {
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
          const paginated = await client.paginateSolveNotifications({
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
