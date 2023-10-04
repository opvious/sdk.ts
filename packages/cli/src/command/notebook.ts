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
import events from 'events';
import {mkdir} from 'fs/promises';
import os from 'os';
import path from 'path';
import {AsyncOrSync} from 'ts-essentials';

import {resourceLoader} from '../common.js';
import {contextualAction, newCommand} from './common.js';

const [errors] = errorFactories({
  definitions: {
    nonZeroExitCode: (code: number) => ({
      message: `Command exited with code ${code}`,
    }),
  },
});

export function notebookCommand(): Command {
  return newCommand()
    .command('notebook')
    // TODO: Allow passing in Jupyter notebook options.
    // TODO: Add option to install additional libraries
    .description('Jupyter notebook commands')
    .addCommand(serverCommand());
}

const defaultNotebookPath = path.join(
  os.homedir(),
  '.local',
  'share',
  'opvious',
  'notebooks'
);

const cachePath = path.join(os.homedir(), '.cache', 'opvious', 'notebooks');

function serverCommand(): Command {
  return newCommand()
    .command('serve')
    .description('start a local Jupyter server')
    .option(
      '-f, --folder <path>',
      'local path where notebooks are stored. the folder will be created ' +
        'if it does not already exist.',
      defaultNotebookPath
    )
    .action(
      contextualAction(async function (opts) {
        const {client, config, spinner} = this;
        const folderPath = path.resolve(opts.folder);
        await Promise.all([
          mkdir(cachePath, {recursive: true}),
          mkdir(folderPath, {recursive: true}),
        ]);

        spinner.info('Starting Jupyter server...');
        const scriptUrl = resourceLoader.localUrl('jupyter/serve.sh');
        console.log(localPath(scriptUrl));
        await runShell(localPath(scriptUrl), {
          OPVIOUS_ENDPOINT: client.apiEndpoint,
          OPVIOUS_TOKEN: config.token,
        });
      })
    );
}

async function runShell(
  lp: LocalPath,
  env?: ProcessEnv
): Promise<void> {
  const child = spawn(lp, [], {
    cwd: cachePath,
    stdio: 'inherit',
    env: {...process.env, ...env},
  });
  let code;
  try {
    [code] = await events.once(child, 'exit');
  } catch (err: any) {
  }
  if (code) {
    throw errors.nonZeroExitCode(code);
  }
}
