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

import {COMMAND_NAME} from '../common';
import {authorizationCommand} from './authorization';
import {contextualAction, newCommand} from './common';
import {formulationCommand} from './formulation';

export function mainCommand(): Command {
  return newCommand()
    .name(COMMAND_NAME)
    .description('Opvious CLI')
    .option('-P, --profile <name>', 'config profile')
    .addCommand(authorizationCommand())
    .addCommand(formulationCommand())
    .addCommand(showAccountCommand());
}

function showAccountCommand(): Command {
  return newCommand()
    .command('me')
    .description('display current credentials')
    .action(
      contextualAction(async function () {
        const {client, spinner} = this;
        spinner.start('Fetching account...');
        const info = await client.fetchAccount();
        spinner.succeed('Fetched account.');
        console.log(info.email);
      })
    );
}
