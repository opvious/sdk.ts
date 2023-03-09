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
import {readFile} from 'fs/promises';
import {DateTime, Duration} from 'luxon';
import {
  computeInputMapping,
  extractInputValues,
  identifyTables,
  InMemorySpreadsheet,
} from 'opvious-sheets';

import {humanizeMillis} from '../common';
import {display} from '../io';
import {contextualAction, newCommand} from './common';

export function attemptCommand(): Command {
  return newCommand()
    .command('attempt')
    .description('attempt commands')
    .addCommand(runAttemptCommand())
    .addCommand(cancelAttemptCommand())
    .addCommand(listAttemptsCommand())
    .addCommand(listAttemptNotificationsCommand());
}

function runAttemptCommand(): Command {
  return newCommand()
    .command('run')
    .description('run a new attempt')
    .requiredOption('-f, --formulation <name>', 'formulation name')
    .option('-t, --tag <name>', 'specification tag')
    .option<ReadonlyArray<string>>(
      '-s, --sheet <path>',
      'path to input spreadsheet. may be specified multiple times.',
      collect,
      []
    )
    .option<ReadonlyArray<string>>(
      '-r, --relax-constraint <label>',
      'soften a constraint. may be specified multiple times.',
      collect,
      []
    )
    .option(
      '-g, --relative-gap <gap>',
      'relative gap threshold. 0.01 is 1%',
      parseFloat,
      0.01
    )
    .option<ReadonlyArray<string>>(
      '--scalar <label=value>',
      'scalar parameter value. may be specified multiple times.',
      collect,
      []
    )
    .option('--detach', 'do not wait for the attempt to complete')
    .option('--solve-timeout <iso>', 'solve timeout', 'PT15S')
    .option('--absolute-gap <gap>', 'absolute gap threshold', parseFloat)
    .option(
      '--relaxation-penalty <penalty>',
      'penalization used for relaxed constraints',
      'TOTAL_DEVIATION'
    )
    .option(
      '--relaxation-objective-weight <weight>',
      'original objective weight in the combined relaxed objective',
      parseFloat,
      0.1
    )
    .action(
      contextualAction(async function (opts) {
        const {client, spinner} = this;
        spinner.start('Fetching outline...');
        const form = await client.fetchOutline(opts.formulation, opts.tag);
        const spec = form.tag.specification;

        spinner
          .succeed(`Fetched outline. [revno=${spec.revno}]`)
          .start('Gathering inputs...');
        const sheets = await Promise.all(
          opts.sheet.map(async (s: string) => [s, await readFile(s, 'utf8')])
        );
        for (const scalar of opts.scalar) {
          const [key, value] = scalar.split('=');
          if (value == null) {
            throw new Error('Invalid scalar: ' + scalar);
          }
          sheets.push(['__scalar_' + key, `${key}\n${value}`]);
        }
        const ss = InMemorySpreadsheet.forCsvs(Object.fromEntries(sheets));
        const tables = identifyTables(ss);
        const mapping = computeInputMapping(tables, spec.outline);
        const inputs = extractInputValues(mapping, ss);

        spinner.succeed('Gathered inputs.').start('Starting attempt...');
        const {uuid} = await client.startAttempt({
          formulationName: opts.formulation,
          specificationTagName: opts.tag,
          inputs: {
            parameters: inputs.parameters ?? [],
            dimensions: inputs.dimensions,
            pinnedVariables: inputs.pinnedVariables,
          },
          options: {
            relativeGapThreshold: opts.relativeGap,
            absoluteGapThreshold: opts.absoluteGap,
            timeoutMillis: +Duration.fromISO(opts.solveTimeout),
            relaxation: opts.relaxConstraint.length
              ? {
                  penalty: opts.relaxationPenalty,
                  constraints: opts.relaxConstraint.map((l: string) => ({
                    label: l,
                  })),
                  objectiveWeight: opts.relaxationObjectiveWeight,
                }
              : undefined,
          },
        });
        spinner.succeed(`Started attempt. [uuid=${uuid}]`);
        if (opts.detach) {
          display('' + client.attemptUrl(uuid));
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
              spinner.succeed(`Attempt solved. [${details.join(', ')}]\n`);
              ok();
            })
            .on('infeasible', () => {
              spinner.warn('Attempt problem is infeasible.\n');
              ok();
            })
            .on('unbounded', () => {
              spinner.warn('Attempt problem is unbounded.\n');
              ok();
            });
        });
      })
    );
}

function cancelAttemptCommand(): Command {
  return newCommand()
    .command('cancel <uuid>')
    .description('cancel pending attempt')
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
            table.cell('url', client.attemptUrl(attempt.uuid));
            table.newRow();
          }
          const {hasPreviousPage, startCursor} = paginated.info;
          cursor = hasPreviousPage ? startCursor : undefined;
          count += paginated.nodes.length;
          spinner.text =
            `Fetched ${count} of ${paginated.totalCount} ` + 'attempts...';
        } while (cursor && count < limit);
        spinner.succeed(`Fetched ${count} attempt(s).\n`);
        display('' + table);
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
        display('' + table);
      })
    );
}

function collect<V>(val: V, acc: ReadonlyArray<V>): ReadonlyArray<V> {
  return acc.concat([val]);
}

function percent(arg: number | string | undefined): string {
  if (typeof arg != 'number' || !isFinite(arg)) {
    return 'inf';
  }
  return ((10_000 * arg) | 0) / 100 + '%';
}
