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

import {localPath} from '@opvious/stl-utils/files';
import {Command} from 'commander';
import {mkdir} from 'fs/promises';
import os from 'os';
import path from 'path';

import {resourceLoader} from '../common.js';
import {contextualAction, newCommand, runShell} from './common.js';

export function notebookCommand(): Command {
  return newCommand()
    .command('notebook')
    .description('Jupyter notebook commands')
    .addCommand(serveCommand());
}

const defaultDataPath = path.join(
  os.homedir(),
  '.local',
  'share',
  'opvious',
  'notebooks'
);

const defaultCachePath = path.join(
  os.homedir(),
  '.cache',
  'opvious',
  'notebooks'
);

function serveCommand(): Command {
  return (
    newCommand()
      .command('serve [args...]')
      .description('start a local Jupyter server')
      .option(
        '-c --cache-folder <path>',
        'local path where the virtual environment will be created',
        defaultCachePath
      )
      .option(
        '-d, --data-folder <path>',
        'local path where notebooks are stored',
        defaultDataPath
      )
      // TODO: Add option to install additional libraries.
      .action(
        contextualAction(async function (args, opts) {
          const {client, config, spinner} = this;
          const cachePath = path.resolve(opts.cacheFolder);
          const dataPath = path.resolve(opts.dataFolder);
          await Promise.all([
            mkdir(cachePath, {recursive: true}),
            mkdir(dataPath, {recursive: true}),
          ]);

          spinner.info('Starting Jupyter server...');
          const scriptUrl = resourceLoader.localUrl('jupyter/serve.sh');
          console.log(localPath(scriptUrl));
          await runShell(localPath(scriptUrl), [dataPath, '-y', ...args], {
            cwd: cachePath,
            env: {
              ...process.env,
              OPVIOUS_ENDPOINT: client.apiEndpoint,
              OPVIOUS_TOKEN: config.token,
            },
          });
        })
      )
  );
}
