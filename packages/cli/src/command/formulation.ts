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
import {readFile} from 'fs/promises';

import {contextualAction, newCommand} from './common';

export function formulationCommand(): Command {
  return newCommand()
    .command('formulation')
    .description('formulation commands')
    .addCommand(listFormulationsCommand())
    .addCommand(registerSpecificationCommand())
    .addCommand(shareFormulationCommand())
    .addCommand(unshareFormulationCommand());
}

function listFormulationsCommand(): Command {
  return newCommand()
    .command('list')
    .description('list formulations')
    .option('-d, --display-name <like>', 'display name filter')
    .option('-l, --limit <limit>', 'maximum number of results', '10')
    .action(
      contextualAction(async function (opts) {
        const {client, spinner} = this;
        spinner.start('Fetching formulations...');
        const infos = await client.listFormulations({
          first: +opts.limit,
          filter: {
            displayNameLike: opts.displayName,
          },
        });
        spinner.succeed(`Fetched ${infos.length} formulation(s).`);
        for (const info of infos) {
          console.log(`${info.displayName}\t${info.hubUrl}`);
        }
      })
    );
}

function registerSpecificationCommand(): Command {
  return newCommand()
    .command('register-specification')
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
          tagNames: opts.tags.split(','),
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
