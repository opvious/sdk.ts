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
import ora, {Ora} from 'ora';
import {AsyncOrSync} from 'ts-essentials';

import {loadConfig} from '../config';

export function newCommand(): Command {
  return new Command().exitOverride((err) => {
    throw err;
  });
}

export function contextualAction(
  fn: (this: ActionContext, ...args: any[]) => AsyncOrSync<void>
): (...args: any[]) => Promise<void> {
  return async (...args): Promise<void> => {
    let cmd = args[args.length - 1]; // Command is always last.
    while (cmd.parent) {
      cmd = cmd.parent;
    }
    const opts = cmd.opts();
    const spinner = ora({isSilent: !!opts.quiet});

    spinner.start('Creating client...');
    try {
      const config = await loadConfig({profile: opts.profile});
      spinner.info(`Created client. [profile=${config.profileName}]`);
      await fn.call({client: config.client, spinner}, ...args);
    } catch (cause: any) {
      spinner.fail(cause.message);
      throw cause;
    }
  };
}

export interface ActionContext {
  readonly spinner: Ora;
  readonly client: OpviousClient;
}