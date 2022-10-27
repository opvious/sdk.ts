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

import {contextualAction, newCommand} from './common';

export function formulationCommand(): Command {
  return newCommand()
    .command('formulation')
    .description('formulation commands')
    .addCommand(listFormulationsCommand())
    .addCommand(registerSpecificationCommand())
    .addCommand(deleteFormulationCommand())
    .addCommand(shareFormulationCommand())
    .addCommand(unshareFormulationCommand());
}

const PAGE_LIMIT = 25;

function listFormulationsCommand(): Command {
  return newCommand()
    .command('list')
    .description('list formulations')
    .option('-d, --display-name <like>', 'display name filter')
    .option('-l, --limit <limit>', 'maximum number of results', '' + PAGE_LIMIT)
    .action(
      contextualAction(async function (opts) {
        const {client, spinner} = this;
        spinner.start('Fetching formulations...');
        const table = new Table();
        const limit = +opts.limit;
        let count = 0;
        let cursor: string | undefined;
        do {
          const paginated = await client.paginateFormulations({
            first: Math.min(PAGE_LIMIT, limit - count),
            after: cursor,
            filter: {
              displayNameLike: opts.displayName,
            },
          });
          for (const val of paginated.values) {
            table.cell('name', val.displayName);
            table.cell('url', val.hubUrl);
            table.newRow();
          }
          const {hasNextPage, endCursor} = paginated.info;
          cursor = hasNextPage ? endCursor : undefined;
          count += paginated.values.length;
          spinner.text =
            `Fetched ${count} of ${paginated.totalCount} ` + 'formulations...';
        } while (cursor && count < limit);
        spinner.succeed(`Fetched ${count} formulation(s).`);
        console.log('\n' + table);
      })
    );
}

function deleteFormulationCommand(): Command {
  return newCommand()
    .command('delete <name>')
    .description('delete a formulation')
    .action(
      contextualAction(async function (name) {
        const {client, spinner} = this;
        spinner.start('Deleting formulation...');
        const deleted = await client.deleteFormulation(name);
        if (deleted) {
          spinner.succeed('Formulation deleted.');
        } else {
          spinner.warn('No formulation matching this name was found.');
        }
      })
    );
}

function registerSpecificationCommand(): Command {
  return newCommand()
    .command('register')
    .description('add a new specification')
    .requiredOption('-f, --formulation <name>', 'matching formulation name')
    .requiredOption('-s, --source <path>', 'path to specification source')
    .option('-d, --description <text>', 'description text, defaults to source')
    .option('-t, --tags <names>', 'comma-separated tag names')
    .action(
      contextualAction(async function (opts) {
        const {client, spinner} = this;
        spinner.start('Extracting definitions...');
        const src = await readFile(opts.source, 'utf8');
        const defs = await client.extractDefinitions(src);
        spinner
          .info(`Extracted ${defs.length} definition(s).`)
          .start('Registering specification...');
        const info = await client.registerSpecification({
          formulationName: opts.formulation,
          definitions: defs,
          description: opts.description ?? src,
          tagNames: opts.tags?.split(','),
        });
        spinner.succeed('Registered specification: ' + info.hubUrl);
      })
    );
}

function shareFormulationCommand(): Command {
  return newCommand()
    .command('share')
    .description('start sharing a formulation')
    .requiredOption('-f, --formulation <name>', 'formulation name')
    .requiredOption('-t, --tag <name>', 'tag name to share')
    .action(
      contextualAction(async function (opts) {
        const {client, spinner} = this;
        spinner.start('Sharing formulation...');
        const info = await client.shareFormulation({
          name: opts.formulation,
          tagName: opts.tag,
        });
        spinner.succeed('Shared formulation: ' + info.hubUrl);
      })
    );
}

function unshareFormulationCommand(): Command {
  return newCommand()
    .command('unshare')
    .description('stop sharing a formulation')
    .requiredOption('-f, --formulation <name>', 'formulation name')
    .option(
      '-t, --tags <names>',
      'comma-separated names to unshare, defaults to all'
    )
    .action(
      contextualAction(async function (opts) {
        const {client, spinner} = this;
        spinner.start('Unsharing formulation...');
        await client.unshareFormulation({
          name: opts.formulation,
          tagNames: opts.tags ? opts.tags.split(',') : undefined,
        });
        spinner.succeed('Unshared formulation.');
      })
    );
}
