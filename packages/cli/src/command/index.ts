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

import {assert, check} from '@opvious/stl-errors';
import {resolvable} from '@opvious/stl-utils/functions';
import {Command} from 'commander';
import Fifo from 'fast-fifo';
import fs from 'fs';
import readline from 'readline';

import {COMMAND_NAME, logPath, packageInfo} from '../common.js';
import {display} from '../io.js';
import {accountCommand} from './account.js';
import {attemptCommand} from './attempt.js';
import {newCommand} from './common.js';
import {formulationCommand} from './formulation.js';

export function mainCommand(): Command {
  return newCommand()
    .name(COMMAND_NAME)
    .description('Opvious CLI')
    .option('-P, --profile <name>', 'config profile')
    .option('-Q, --quiet', 'suppress spinner output')
    .addCommand(accountCommand())
    .addCommand(attemptCommand())
    .addCommand(formulationCommand())
    .addCommand(logCommand())
    .addCommand(versionCommand());
}

function logCommand(): Command {
  return newCommand()
    .command('log')
    .description('display log path')
    .option(
      '-n, --last [lines]',
      'display last lines of log file. if the count is absent, will show all ' +
        'lines from the last command run'
    )
    .action(async (opts) => {
      const fp = logPath();
      const {last} = opts;
      if (last == null) {
        display(fp);
        return;
      }
      if (last === true) {
        const lines = await lastContextualCommandLines(fp);
        lines.forEach((l) => display(l));
        return;
      }
      const count = check.isNumeric(last);
      assert(count > 0, 'Line count must be positive (got %d)', count);
      const fifo = await lastLines(fp, count);
      while (!fifo.isEmpty()) {
        display(fifo.shift()!);
      }
    });
}

function lastContextualCommandLines(
  fp: string
): Promise<ReadonlyArray<string>> {
  const [ret, cb] = resolvable<ReadonlyArray<string>>();
  let last: string[] = [];
  let temp: string[] = [];
  let hasCtx = false;
  let pid: any;

  readline
    .createInterface(fs.createReadStream(fp))
    .on('error', cb)
    .on('line', (line) => {
      const {ctx, pid: lpid} = JSON.parse(line);
      if (pid != null && lpid !== pid) {
        flush();
      }
      pid = lpid;
      hasCtx = hasCtx || !!ctx;
      temp.push(line);
    })
    .on('close', () => {
      flush();
      cb(null, last);
    });

  function flush(): void {
    if (hasCtx) {
      last = temp;
    }
    hasCtx = false;
    temp = [];
  }

  return ret;
}

function lastLines(fp: string, count: number): Promise<Fifo<string>> {
  const [ret, cb] = resolvable<Fifo<string>>();
  const fifo = new Fifo<string>();
  readline
    .createInterface(fs.createReadStream(fp))
    .on('error', cb)
    .on('line', (line) => {
      fifo.push(line);
      if (--count < 0) {
        fifo.shift();
      }
    })
    .on('close', () => {
      cb(null, fifo);
    });
  return ret;
}

function versionCommand(): Command {
  return newCommand()
    .command('version')
    .description('display version')
    .action(() => {
      display(check.isPresent(packageInfo.version));
    });
}
