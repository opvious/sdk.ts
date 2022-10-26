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
import {OpviousClient} from 'opvious';

import {COMMAND_NAME} from './common';

export function mainCommand(): Command {
  return newCommand()
    .name(COMMAND_NAME)
    .description('Opvious CLI')
    .option('-P, --profile <name>', 'config profile')
    .addCommand(formulationCommand());
}

function formulationCommand(): Command {
  return newCommand()
    .command('formulation')
    .description('formulation commands')
    .addCommand(registerSpecificationCommand());
}

function registerSpecificationCommand(): Command {
  return newCommand()
    .command('register-specification')
    .description('add a new specification')
    .requiredOption('-f, --formulation <name>', 'matching formulation name')
    .requiredOption('-s, --source <path>', 'path to specification source')
    .action(async (opts) => {
      const client = OpviousClient.create();
      await client.registerSpecification({
        formulationName: opts.formulation,
        source: opts.source,
      });
    });
}

function newCommand(): Command {
  return new Command().exitOverride((cause) => {
    throw cause;
  });
}
