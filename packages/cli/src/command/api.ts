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

import {
  API_IMAGE_EULA_EVAR,
  assertApiImageEulaAccepted,
} from '@opvious/api/eulas';
import {
  check,
  errorFactories,
  isStandardError,
  rethrowUnless,
} from '@opvious/stl-errors';
import {ProcessEnv} from '@opvious/stl-utils/environment';
import {LocalPath, localPath} from '@opvious/stl-utils/files';
import {ifPresent} from '@opvious/stl-utils/functions';
import {Command} from 'commander';
import crypto from 'crypto';
import {mkdir} from 'fs/promises';
import __inline from 'inlinable';
import fetch from 'node-fetch';
import nodeMachineId from 'node-machine-id';
import os from 'os';
import path from 'path';
import {AsyncOrSync} from 'ts-essentials';

import {resourceLoader} from '../common.js';
import {
  ActionContext,
  contextualAction,
  errorCodes,
  newCommand,
  runShell,
} from './common.js';

const [errors] = errorFactories({
  definitions: {
    dockerCommandMissing: (lp: LocalPath) => ({
      message:
        `No command available at \`${lp}\`. Please make sure docker is ` +
        'installed',
    }),
    invalidLicenseKey: 'This license key is invalid',
  },
});

export function apiCommand(): Command {
  return newCommand()
    .command('api')
    .description('self-hosted API commands')
    .addCommand(startCommand())
    .addCommand(stopCommand())
    .addCommand(viewLogsCommand());
}

const defaultBucketPath = path.join(os.tmpdir(), 'opvious-api-bucket');

const DEFAULT_IMAGE_TAG = 'latest';

const DEFAULT_PORT = '8080';

function startCommand(): Command {
  return newCommand()
    .command('start')
    .description('start an API server in the background')
    .option(
      '-b, --bucket <path>',
      'local path where data will be stored. the folder will be created ' +
        'with permissions 0777 if it does not already exist. if it already ' +
        'exists, it must be readable and writable by UID 1000 or GID 1000',
      defaultBucketPath
    )
    .option(
      '-i, --image-tag <tag>',
      'server image tag. setting this flag explicitly will also cause ' +
        'the image to always be pulled (default: "latest")'
    )
    .option('-p, --port <port>', 'host port to bind to', DEFAULT_PORT)
    .option(
      '-w, --wait',
      'wait for the API server to be ready to accept requests before returning'
    )
    .option(
      '--force-recreate',
      'always create new containers. by default this command is a no-op if ' +
        'the API is already running'
    )
    .option(
      '--log-level <level>',
      'API server log level',
      'warn,@opvious/api-server=debug'
    )
    .option(
      '--password <password>',
      'password used to connect to the database and cache. the default is ' +
        'derived from the machine\'s ID. the same value should be used ' +
        'across restarts'
    )
    .action(
      dockerAction(async function (opts) {
        assertApiImageEulaAccepted();

        const args = ['up', '--detach'];
        if (opts.forceRecreate) {
          args.push('--force-recreate');
        } else {
          args.push('--no-recreate');
        }
        if (opts.imageTag) {
          args.push('--pull=always');
        }
        if (opts.wait) {
          args.push('--wait');
        }

        let licenseEnv: ProcessEnv | undefined;
        if (this.license) {
          this.spinner.start('Validating license...');
          const licensee = await fetchLicensee(this.license);
          this.spinner.info(`Validated license. [email=${licensee}]`);
          const pass = opts.password ?? (await defaultPassword());
          licenseEnv = {
            ADMIN_EMAILS: licensee,
            DB_URL: `postgres://postgres:${pass}@db/opvious`,
            PASSWORD: pass,
            REDIS_URL: `redis://:${pass}@redis`,
          };
        }

        const bucket = path.resolve(opts.bucket);
        await mkdir(bucket, {recursive: true});
        await this.runCompose(args, {
          BUCKET_PATH: bucket,
          IMAGE_TAG: opts.imageTag ?? DEFAULT_IMAGE_TAG,
          LOG_LEVEL: opts.logLevel,
          PORT: opts.port,
          ...licenseEnv,
        });
      })
    );
}

const KEYGEN_ACCOUNT_ID = __inline(
  'obfuscate',
  () => '503b6545-cc50-4511-b547-4dcd9b4f9078'
);

async function fetchLicensee(key: string): Promise<string> {
  const res = await fetch(
    `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses/actions/validate-key`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({meta: {key}}),
    }
  );
  const payload: any = await res.json();
  if (!payload.meta.valid) {
    throw errors.invalidLicenseKey();
  }
  const {metadata} = payload.data.attributes;
  return check.isString(metadata.email);
}

async function defaultPassword(): Promise<string> {
  const mid = await nodeMachineId.machineId();
  const buf = crypto.createHash('sha256').update(mid).digest();
  return buf.toString('hex');
}

function stopCommand(): Command {
  return newCommand()
    .command('stop')
    .description('stop server')
    .action(
      dockerAction(async function () {
        await this.runCompose(['down']);
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
      dockerAction(async function (opts) {
        const args = ['logs', 'server', '--no-log-prefix'];
        if (opts.follow) {
          args.push('--follow');
        }
        if (opts.since) {
          args.push(`--since=${opts.since}`);
        }
        await this.runCompose(args);
      })
    );
}

function dockerAction(
  fn: (this: DockerComposeActionContext, ...args: any[]) => AsyncOrSync<void>
): (...args: any[]) => Promise<void> {
  return contextualAction(async function (...args) {
    const {config, spinner} = this;

    const license = ifPresent(config.token, tokenLicense);
    const flag = `--file=compose.${license ? 'std' : 'dev'}.yaml`;

    const lp = config.dockerCommand ?? 'docker';
    spinner.info(`Running docker command... [path=${lp}]`);
    return fn.call(
      {
        ...this,
        license,
        runCompose: (args, env) =>
          runDocker(lp, ['compose', flag, ...args], env),
      },
      ...args
    );
  });
}

function tokenLicense(token: string): string | undefined {
  const [name, suffix] = token.split(':', 2);
  return name === 'license' ? suffix : undefined;
}

interface DockerComposeActionContext extends ActionContext {
  readonly license: string | undefined;
  readonly runCompose: (
    args: ReadonlyArray<string>,
    env?: ProcessEnv
  ) => Promise<void>;
}

async function runDocker(
  lp: LocalPath,
  args: ReadonlyArray<string>,
  env?: ProcessEnv
): Promise<void> {
  try {
    await runShell(lp, args, {
      cwd: localPath(resourceLoader.localUrl('docker')),
      env: {
        [API_IMAGE_EULA_EVAR]: '',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',
        OTEL_TRACES_SAMPLER_ARG: '1',
        ...process.env,
        ADMIN_EMAILS: '',
        BUCKET_PATH: '/unused',
        DB_URL: 'inop://',
        IMAGE_TAG: DEFAULT_IMAGE_TAG,
        REDIS_URL: '',
        LOG_LEVEL: '',
        PASSWORD: '',
        PORT: DEFAULT_PORT,
        ...env,
      },
    });
  } catch (err) {
    rethrowUnless(
      isStandardError(err, errorCodes.SpawnFailed) &&
        err.tags.code === 'ENOENT',
      err
    );
    throw errors.dockerCommandMissing(lp);
  }
}
