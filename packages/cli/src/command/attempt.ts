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
import {DateTime} from 'luxon';

import {contextualAction, newCommand} from './common';

export function attemptCommand(): Command {
  return newCommand()
    .command('attempt')
    .description('attempt commands')
    .addCommand(listAttemptsCommand());
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
            first: Math.min(PAGE_LIMIT, limit - count),
            after: cursor,
          });
          for (const val of paginated.values) {
            table.cell('formulation', val.formulationName);
            table.cell('revno', val.specificationRevno);
            table.cell('status', val.status);
            table.cell('started', DateTime.fromISO(val.startedAt).toRelative());
            table.cell(
              'ended',
              val.endedAt ? DateTime.fromISO(val.endedAt).toRelative() : ''
            );
            table.cell('url', val.hubUrl);
            table.newRow();
          }
          const {hasNextPage, endCursor} = paginated.info;
          cursor = hasNextPage ? endCursor : undefined;
          count += paginated.values.length;
          spinner.text =
            `Fetched ${count} of ${paginated.totalCount} ` + 'attempts...';
        } while (cursor && count < limit);
        spinner.succeed(`Fetched ${count} attempt(s).`);
        console.log('\n' + table);
      })
    );
}
