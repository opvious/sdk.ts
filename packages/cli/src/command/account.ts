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
import Table from 'easy-table';
import {DateTime} from 'luxon';

import {display} from '../io.js';
import {contextualAction, newCommand} from './common.js';

export function accountCommand(): Command {
  return newCommand()
    .command('account')
    .description('account management commands')
    .addCommand(listAuthorizationsCommand())
    .addCommand(generateAuthorizationCommand())
    .addCommand(revokeAuthorizationCommand());
}

function listAuthorizationsCommand(): Command {
  return newCommand()
    .command('authorizations')
    .description('list authorizations')
    .action(
      contextualAction(async function () {
        const {client, spinner} = this;
        spinner.start('Fetching authorizations...');
        const infos = await client.listAuthorizations();
        const table = new Table();
        for (const info of infos) {
          table.cell('name', info.name);
          table.cell('created', DateTime.fromISO(info.createdAt).toRelative());
          table.cell(
            'last_used',
            info.lastUsedAt
              ? DateTime.fromISO(info.lastUsedAt).toRelative()
              : ''
          );
          table.cell(
            'expiration',
            DateTime.fromISO(info.expiresAt).toRelative()
          );
          table.cell('token_suffix', info.tokenSuffix);
          table.newRow();
        }
        spinner.succeed(`Fetched ${infos.length} authorizations(s).\n`);
        if (infos.length) {
          display('' + table);
        }
      })
    );
}

function generateAuthorizationCommand(): Command {
  return newCommand()
    .command('generate-authorization <name>')
    .description('create an access token')
    .option('-t, --ttl <days>', 'authorization TTL', '30')
    .action(
      contextualAction(async function (name, opts) {
        const {client, spinner} = this;
        spinner.start('Creating authorization...');
        const token = await client.generateAccessToken({
          name,
          ttlDays: +opts.ttl,
        });
        spinner.succeed('Authorization created.\n');
        display(token);
      })
    );
}

function revokeAuthorizationCommand(): Command {
  return newCommand()
    .command('revoke-authorization <name>')
    .description('revoke authorization')
    .action(
      contextualAction(async function (name) {
        const {client, spinner} = this;
        spinner.start('Revoking authorization...');
        const revoked = await client.revokeAuthorization(name);
        if (revoked) {
          spinner.succeed('Authorization revoked.');
        } else {
          spinner.warn('No matching authorization to revoke.');
        }
      })
    );
}
