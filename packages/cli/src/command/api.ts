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

import {errorFactories} from '@opvious/stl-errors';
import {LocalPath, localPath} from '@opvious/stl-utils/files';
import {spawn} from 'child_process';
import {Command} from 'commander';
import crypto from 'crypto';
import events from 'events';
import {AsyncOrSync} from 'ts-essentials';

import {resourceLoader} from '../common.js';
import {contextualAction, newCommand} from './common.js';

const [errors] = errorFactories({
  definitions: {
    commandMissing: (lp: LocalPath) => ({
      message:
        `No command available at \`${lp}\`. Please make sure docker-compose ` +
        'is installed',
    }),
    spawnFailed: (cause: unknown) => ({
      message: 'Unable to run command',
      cause,
    }),
    nonZeroExitCode: (code: number) => ({
      message: `Command exited with code ${code}`,
    }),
  },
  prefix: 'ERR_DOCKER_COMPOSE_',
});

export function apiCommand(): Command {
  return newCommand()
    .command('api')
    .description('self-hosted API commands')
    .addCommand(startCommand())
    .addCommand(stopCommand())
    .addCommand(viewLogsCommand());
}

function startCommand(): Command {
  return (
    newCommand()
      .command('start')
      .description('start API server')
      .option('-w, --wait', 'wait for all services to be ready')
      // TODO: bundle variant based on active license
      .action(
        dockerComposeAction(async function (opts) {
          const args = ['up', '--detach', '--no-recreate'];
          if (opts.wait) {
            args.push('--wait');
          }
          await this.run(args);
        })
      )
  );
}

function stopCommand(): Command {
  return newCommand()
    .command('stop')
    .description('stop running API server')
    .action(
      dockerComposeAction(async function () {
        await this.run(['down']);
      })
    );
}

function viewLogsCommand(): Command {
  return newCommand()
    .command('logs')
    .description('view API logs')
    .option('-f, --follow')
    .option('-s, --since <duration>', 'TODO', '5m')
    .action(
      dockerComposeAction(async function (opts) {
        const args = ['logs', 'server', '--no-log-prefix'];
        if (opts.follow) {
          args.push('--follow');
        }
        if (opts.since) {
          args.push(`--since=${opts.since}`);
        }
        await this.run(args);
      })
    );
}

function dockerComposeAction(
  fn: (this: DockerComposeActionContext, ...args: any[]) => AsyncOrSync<void>
): (...args: any[]) => Promise<void> {
  return contextualAction(async function (...args) {
    const {config, spinner} = this;
    const lp = config.dockerComposePath ?? 'docker-compose';
    spinner.info(`Running command... [path=${lp}]`);
    return fn.call({run: (args) => dockerCompose(lp, args)}, ...args);
  });
}

interface DockerComposeActionContext {
  readonly run: (args: ReadonlyArray<string>) => Promise<void>;
}

async function dockerCompose(
  lp: LocalPath,
  args: ReadonlyArray<string>
): Promise<void> {
  const child = spawn(lp, args, {
    cwd: localPath(resourceLoader.localUrl('docker')),
    stdio: 'inherit',
    env: {
      ...process.env,
      POSTGRES_PASS: randomPassword(),
      REDIS_PASS: randomPassword(),
    },
  });
  let code;
  try {
    [code] = await events.once(child, 'exit');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw errors.commandMissing(lp);
    }
    throw errors.spawnFailed(err);
  }
  if (code) {
    throw errors.nonZeroExitCode(code);
  }
}

function randomPassword(): string {
  return crypto.randomBytes(12).toString('hex');
}
