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
import {Command} from 'commander';
import Table from 'easy-table';
import {createWriteStream} from 'fs';
import {writeFile} from 'fs/promises';
import {DateTime} from 'luxon';
import {loadProblem} from 'opvious';
import {pipeline as streamPipeline} from 'stream/promises';
import YAML from 'yaml';

import {humanizeMillis} from '../common.js';
import {display} from '../io.js';
import {contextualAction, newCommand} from './common.js';
import {queueCommand} from './queue.js';

export function problemCommand(): Command {
  return newCommand()
    .command('problem')
    .description('problem solving commands')
    .addCommand(solveCommand())
    .addCommand(formatCommand())
    .addCommand(attemptsCommand())
    .addCommand(queueCommand());
}

function solveCommand(): Command {
  return newCommand()
    .command('solve')
    .description('solve an optimization problem')
    .argument('<path>', 'path to problem data')
    .option('-j, --json-path <path>', 'JSONPath to nested problem data')
    .option(
      '-o, --output <path>',
      'output path, not applicable for queued solves (default: stdout)'
    )
    .option('-q, --queue', 'queue the solve')
    .action(
      contextualAction(async function (lp, opts) {
        const {client, spinner} = this;
        spinner.start('Parsing problem...');

        const prob = await loadProblem(lp, {jsonPath: opts.jsonPath});
        spinner.succeed(
          `Parsed problem. [parameters=${prob.inputs.parameters.length}]`
        );

        if (opts.queue) {
          spinner.start('Queuing solve...');
          const {uuid} = await client.queueSolve({problem: prob});
          spinner.succeed(`Queued solve. [uuid=${uuid}]`);
          return;
        }

        spinner.start('Solving...');
        const tracker = client.runSolve({problem: prob}).on('solving', (p) => {
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
      return `${((1000 * +gap) | 0) / 10}%`;
  }
}

function formatCommand(): Command {
  return newCommand()
    .command('format')
    .description('print a problem\'s LP representation')
    .argument('<path>', 'path to problem data or queued solve UUID')
    .option(
      '-j, --json-path <path>',
      'JSONPath to nested problem data. only applicable with local path'
    )
    .option('-o, --output <path>', 'output path (default: stdout)')
    .action(
      contextualAction(async function (arg, opts) {
        const {client, spinner} = this;
        const out = opts.output
          ? createWriteStream(opts.output)
          : process.stdout;
        spinner.start('Parsing problem...');
        const prob = await loadProblem(arg, {jsonPath: opts.jsonPath});
        spinner.succeed('Parsed problem.').start('Formatting problem...');
        const readable = client.formatProblem({problem: prob});
        if (!opts.output) {
          spinner.stop().clear();
        }
        await streamPipeline(readable, out);
        if (opts.output) {
          spinner.succeed('Formatted problem.');
        }
      })
    );
}

const PAGE_LIMIT = 25;

function attemptsCommand(): Command {
  return newCommand()
    .command('attempts')
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
            table.cell('started', startedAt.toRelative());
            table.cell(
              'runtime',
              endedAt ? humanizeMillis(+endedAt.diff(startedAt)) : ''
            );
            table.cell('operation', attempt.operation);
            table.cell(
              'status',
              attempt.errorStatus ?? (endedAt ? 'OK' : '...')
            );
            // table.cell('credits', attempt.chargeAmount);
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
