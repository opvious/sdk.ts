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
import {WithActiveSpanParams} from '@opvious/stl-telemetry';
import {LocalPath} from '@opvious/stl-utils/files';
import {spawn, SpawnOptions} from 'child_process';
import {Command, CommanderError} from 'commander';
import events from 'events';
import {OpviousClient} from 'opvious';
import ora, {Ora} from 'ora';
import {AsyncOrSync} from 'ts-essentials';

import {COMMAND_NAME, telemetry} from '../common.js';
import {Config, loadConfig} from '../config.js';

const [errors, codes] = errorFactories({
  definitions: {
    setupFailed: (cause: unknown) => ({message: 'Setup failed', cause}),
    actionFailed: (cause: unknown) => ({message: 'Command failed', cause}),
    commandAborted: (cause: CommanderError) => ({
      message: 'Command aborted',
      cause,
      tags: {exitCode: cause.exitCode},
    }),
    // Shell commands
    spawnFailed: (cause: unknown) => ({
      message: 'Unable to run command',
      tags: {code: (cause as any)?.code},
      cause,
    }),
    nonZeroExitCode: (code: number) => ({
      message: `Command exited with code ${code}`,
    }),
  },
});

export const commandAbortedError = errors.commandAborted;

export const errorCodes = codes;

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

    const spanParams: WithActiveSpanParams = {name: COMMAND_NAME + ' command'};
    return telemetry.withActiveSpan(spanParams, async (span) => {
      const sctx = span.spanContext();
      const {traceId} = sctx;
      spinner
        .info(`Initialized context. [trace=${traceId}]`)
        .start('Loading client...');

      let cfg;
      try {
        cfg = await loadConfig({
          profile: opts.profile,
          impersonation: parseImpersonation(opts.impersonate),
        });
        let msg = 'Loaded client.';
        if (cfg.profileName) {
          msg += ` [profile=${cfg.profileName}]`;
        }
        spinner.info(msg);
      } catch (cause) {
        spinner.fail(errorMessage(cause));
        throw errors.setupFailed(cause);
      }

      const ctx: ActionContext = {spinner, config: cfg, client: cfg.client};
      try {
        await fn.call(ctx, ...args);
      } catch (cause) {
        spinner.fail(errorMessage(cause));
        throw errors.actionFailed(cause);
      }
    });
  };
}

export interface ActionContext {
  readonly spinner: Ora;
  readonly config: Config;
  readonly client: OpviousClient;
}

export async function runShell(
  lp: LocalPath,
  args: ReadonlyArray<string>,
  opts?: SpawnOptions
): Promise<void> {
  const child = spawn(lp, args, {stdio: 'inherit', ...opts});
  let code;
  try {
    [code] = await events.once(child, 'exit');
  } catch (err) {
    throw errors.spawnFailed(err);
  }
  if (code) {
    throw errors.nonZeroExitCode(code);
  }
}

const impersonatePattern = /^([^!?]+)([!?]*)/;

function parseImpersonation(opt: string | undefined): string | undefined {
  const match = opt ? impersonatePattern.exec(opt) : undefined;
  if (!match) {
    return undefined;
  }
  const parts = [match[1]];
  const suffix = match[2] ?? '';
  if (suffix.includes('?')) {
    parts.push('create-if-unknown');
  }
  if (suffix.includes('!')) {
    parts.push('forward-privileges');
  }
  return parts.join('; ');
}
