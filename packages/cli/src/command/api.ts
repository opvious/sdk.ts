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
import {ProcessEnv} from '@opvious/stl-utils/environment';
import {LocalPath, localPath} from '@opvious/stl-utils/files';
import {spawn} from 'child_process';
import {Command} from 'commander';
import crypto from 'crypto';
import events from 'events';
import os from 'os';
import path from 'path';
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

const defaultBucketPath = path.join(os.tmpdir(), 'opvious-data');

const DEFAULT_IMAGE_TAG = 'latest';

function startCommand(): Command {
  return newCommand()
    .command('start')
    .description('start server')
    .option(
      '-b, --bucket <path>',
      'local path where attempt data will be stored',
      defaultBucketPath
    )
    .option(
      '-f, --fresh',
      'always recreate fresh containers. by default this command is a ' +
        'no-op if the API is already running'
    )
    .option(
      '-i, --image-tag <tag>',
      'server image tag. setting this flag explicitly will also cause ' +
        'the image to always be pulled. (default: "latest")'
    )
    .option(
      '-l, --log-level <level>',
      'server log level',
      'info,@opvious/api-server=debug'
    )
    .option('-t, --static-tokens <tokens>', 'static authorization tokens', '')
    .option('-w, --wait', 'wait for all services to be ready')
    .action(
      dockerComposeAction(async function (opts) {
        const args = ['up', '--detach'];
        if (opts.fresh) {
          args.push('--force-recreate', '--renew-anon-volumes');
        } else {
          args.push('--no-recreate');
        }
        if (opts.imageTag) {
          args.push('--pull=always');
        }
        if (opts.wait) {
          args.push('--wait');
        }
        await this.run(args, {
          BUCKET_PATH: opts.bucket,
          IMAGE_TAG: opts.imageTag ?? DEFAULT_IMAGE_TAG,
          LOG_LEVEL: opts.logLevel,
          STATIC_TOKENS: opts.staticTokens,
        });
      })
    );
}

function stopCommand(): Command {
  return newCommand()
    .command('stop')
    .description('stop server')
    .action(
      dockerComposeAction(async function () {
        await this.run(['down']);
      })
    );
}

function viewLogsCommand(): Command {
  return newCommand()
    .command('logs')
    .description('view server logs')
    .option('-f, --follow', 'follow changes')
    .option('-s, --since <duration>', 'log start time cutoff', '5m')
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
    return fn.call({run: (args, env) => dockerCompose(lp, args, env)}, ...args);
  });
}

interface DockerComposeActionContext {
  readonly run: (
    args: ReadonlyArray<string>,
    env?: ProcessEnv
  ) => Promise<void>;
}

async function dockerCompose(
  lp: LocalPath,
  args: ReadonlyArray<string>,
  env?: ProcessEnv
): Promise<void> {
  const child = spawn(lp, args, {
    cwd: localPath(resourceLoader.localUrl('docker')),
    stdio: 'inherit',
    env: {
      ...process.env,
      BUCKET_PATH: '/unused',
      IMAGE_TAG: DEFAULT_IMAGE_TAG,
      STATIC_TOKENS: '',
      LOG_LEVEL: '',
      POSTGRES_PASS: randomPassword(),
      REDIS_PASS: randomPassword(),
      ...env,
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
