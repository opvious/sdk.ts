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

import {errorFactories, errorMessage} from '@opvious/stl-errors';
import {withActiveSpan, WithActiveSpanParams} from '@opvious/stl-telemetry';
import {Command, CommanderError} from 'commander';
import {OpviousClient} from 'opvious';
import ora, {Ora} from 'ora';
import {AsyncOrSync} from 'ts-essentials';

import {COMMAND_NAME, telemetry} from '../common';
import {loadConfig} from '../config';

const [errors, codes] = errorFactories({
  definitions: {
    setupFailed: (cause: unknown) => ({message: 'Setup failed', cause}),
    actionFailed: (cause: unknown) => ({message: 'Command failed', cause}),
    commandAborted: (cause: CommanderError) => ({
      message: 'Command aborted',
      cause,
      tags: {exitCode: cause.exitCode},
    }),
  },
});

export const commandAbortedError = errors.commandAborted;
export const commandCodes = codes;

export function newCommand(): Command {
  return new Command().exitOverride((cause) => {
    throw errors.commandAborted(cause);
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

    const spanParams: WithActiveSpanParams = {
      name: COMMAND_NAME + ' command',
      tracer: telemetry.tracer,
    };
    return withActiveSpan(spanParams, async (span) => {
      const sctx = span.spanContext();
      const {traceId} = sctx;
      spinner
        .info(`Initialized context. [trace=${traceId}]`)
        .start('Loading client...');

      let config;
      try {
        config = await loadConfig({profile: opts.profile});
        let msg = 'Loaded client.';
        if (config.profileName) {
          msg += ` [profile=${config.profileName}]`;
        }
        spinner.succeed(msg);
      } catch (cause) {
        spinner.fail(errorMessage(cause));
        throw errors.setupFailed(cause);
      }

      try {
        await fn.call({client: config.client, spinner}, ...args);
      } catch (cause) {
        spinner.fail(errorMessage(cause));
        throw errors.actionFailed(cause);
      }
    });
  };
}

export interface ActionContext {
  readonly spinner: Ora;
  readonly client: OpviousClient;
}
