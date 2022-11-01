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
import {contextualAction, newCommand} from './common';

export function attemptCommand(): Command {
  return newCommand()
    .command('attempt')
    .description('attempt commands')
    .addCommand(downloadAttemptCommand())
    .addCommand(listAttemptsCommand())
    .addCommand(runAttemptCommand());
}

const PAGE_LIMIT = 25;

function downloadAttemptCommand(): Command {
  return newCommand()
    .command('download <uuid>')
    .description('download attempt data')
    .option('-i, --inputs', 'include inputs')
    .action(
      contextualAction(async function (uuid, opts) {
        const {client, spinner} = this;
        spinner.start('Downloading attempt...');
        await client.fetchAttemptOutputs(uuid);
        if (opts.inputs) {
          await client.fetchAttemptInputs(uuid);
        }
        spinner.succeed('Downloaded attempt.');
      })
    );
}

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
          for (const val of [...paginated.values].reverse()) {
            const startedAt = DateTime.fromISO(val.startedAt);
            const endedAt = val.endedAt
              ? DateTime.fromISO(val.endedAt)
              : undefined;
            table.cell('formulation', val.formulationName);
            table.cell('revno', val.specificationRevno);
            table.cell('status', val.status);
            table.cell('started', startedAt.toRelative());
            table.cell(
              'runtime',
              endedAt ? humanizeMillis(+endedAt.diff(startedAt)) : ''
            );
            table.cell('url', val.hubUrl);
            table.newRow();
          }
          const {hasPreviousPage, startCursor} = paginated.info;
          cursor = hasPreviousPage ? startCursor : undefined;
          count += paginated.values.length;
          spinner.text =
            `Fetched ${count} of ${paginated.totalCount} ` + 'attempts...';
        } while (cursor && count < limit);
        spinner.succeed(`Fetched ${count} attempt(s).`);
        console.log('\n' + table);
      })
    );
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
    .option('--solve-timeout <iso>', 'solve timeout', 'PT2M')
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
        const outline = await client.fetchOutline(opts.formulation, opts.tag);

        spinner
          .succeed(`Fetched outline. [revno=${outline.revno}]`)
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
        const mapping = computeInputMapping(tables, outline);
        const inputs = extractInputValues(mapping, ss);

        spinner.succeed('Gathered inputs.').start('Starting attempt...');
        const info = await client.startAttempt({
          formulationName: opts.formulation,
          specificationTagName: opts.tag,
          dimensions: inputs.dimensions,
          parameters: inputs.parameters,
          pinnedVariables: inputs.pinnedVariables,
          relativeGapThreshold: opts.relativeGap,
          absoluteGapThreshold: opts.absoluteGap,
          solveTimeoutMillis: +Duration.fromISO(opts.solveTimeout),
          relaxation: opts.relaxConstraint.length
            ? {
                penalty: opts.relaxationPenalty,
                constraints: opts.relaxConstraint.map((l: string) => ({
                  label: l,
                })),
                objectiveWeight: opts.relaxationObjectiveWeight,
              }
            : undefined,
        });
        spinner.succeed(`Started attempt. [uuid=${info.uuid}]`);
        if (!opts.detach) {
          spinner.start('Waiting for outcome...');
          const outcome = await client.waitForOutcome(info.uuid);
          spinner.succeed(
            `Attempt succeeded. [value=${outcome.objectiveValue}]`
          );
        }
        console.log('Attempt URL: ' + info.hubUrl);
      })
    );
}

function collect<V>(val: V, acc: ReadonlyArray<V>): ReadonlyArray<V> {
  return acc.concat([val]);
}
