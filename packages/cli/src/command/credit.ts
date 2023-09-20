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

import {display} from '../io.js';
import {contextualAction, newCommand} from './common.js';

export function creditCommand(): Command {
  return newCommand()
    .command('credit')
    .description('credit tracking commands')
    .addCommand(listChargesCommand())
    .addCommand(listGrantsCommand());
}

const PAGE_LIMIT = 25;

function listChargesCommand(): Command {
  return newCommand()
    .command('charges')
    .description('list credit charges')
    .option('-l, --limit <limit>', 'maximum number of results', '' + PAGE_LIMIT)
    .action(
      contextualAction(async function (opts) {
        const {client, spinner} = this;
        spinner.start('Fetching charges...');
        const table = new Table();
        const limit = +opts.limit;
        let count = 0;
        let cursor: string | undefined;
        do {
          const paginated = await client.paginateCreditCharges({
            last: Math.min(PAGE_LIMIT, limit - count),
            before: cursor,
          });
          for (const node of [...paginated.nodes].reverse()) {
            table.cell(
              'created',
              DateTime.fromISO(node.createdAt).toRelative()
            );
            table.cell('amount', node.amount);
            table.cell('reason', node.reason);
            table.newRow();
          }
          const {hasPreviousPage, startCursor} = paginated.info;
          cursor = hasPreviousPage ? startCursor : undefined;
          count += paginated.nodes.length;
          spinner.text =
            `Fetched ${count} of ${paginated.totalCount} ` + 'charge(s)...';
        } while (cursor && count < limit);
        spinner.succeed(`Fetched ${count} charge(s).\n`);
        if (count) {
          display('' + table);
        }
      })
    );
}

function listGrantsCommand(): Command {
  return newCommand()
    .command('grants')
    .description('list credit grants')
    .option('-l, --limit <limit>', 'maximum number of results', '' + PAGE_LIMIT)
    .action(
      contextualAction(async function (opts) {
        const {client, spinner} = this;
        spinner.start('Fetching grants...');
        const table = new Table();
        const limit = +opts.limit;
        let count = 0;
        let cursor: string | undefined;
        do {
          const paginated = await client.paginateCreditGrants({
            last: Math.min(PAGE_LIMIT, limit - count),
            before: cursor,
          });
          for (const node of [...paginated.nodes].reverse()) {
            table.cell(
              'created',
              DateTime.fromISO(node.createdAt).toRelative()
            );
            table.cell('amount', node.amount);
            table.cell('reason', node.reason);
            table.newRow();
          }
          const {hasPreviousPage, startCursor} = paginated.info;
          cursor = hasPreviousPage ? startCursor : undefined;
          count += paginated.nodes.length;
          spinner.text =
            `Fetched ${count} of ${paginated.totalCount} ` + 'grant(s)...';
        } while (cursor && count < limit);
        spinner.succeed(`Fetched ${count} grant(s).\n`);
        if (count) {
          display('' + table);
        }
      })
    );
}
