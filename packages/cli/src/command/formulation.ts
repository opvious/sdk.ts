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

import {codeFrameColumns} from '@babel/code-frame';
import {check, errors} from '@opvious/stl-errors';
import {watch} from 'chokidar';
import {Command} from 'commander';
import debounce from 'debounce';
import Table from 'easy-table';
import {readFile} from 'fs/promises';
import {DateTime} from 'luxon';
import * as api from 'opvious/api';
import path from 'path';

import {display} from '../io';
import {contextualAction, newCommand} from './common';

export function formulationCommand(): Command {
  return newCommand()
    .command('formulation')
    .description('formulation commands')
    .addCommand(registerSpecificationCommand())
    .addCommand(validateSpecification())
    .addCommand(listFormulationsCommand())
    .addCommand(fetchOutlineCommand())
    .addCommand(deleteFormulationCommand())
    .addCommand(shareFormulationCommand())
    .addCommand(unshareFormulationCommand());
}

const PAGE_LIMIT = 25;

function fetchOutlineCommand(): Command {
  return newCommand()
    .command('outline <name>')
    .option('-t, --tag <name>', 'specification tag')
    .description('display a formulation\'s outline')
    .action(
      contextualAction(async function (name, opts) {
        const {client, spinner} = this;
        spinner.start('Fetching outline...');
        const form = await client.fetchOutline(name, opts.tag);
        const {revno, outline} = form.tag.specification;
        spinner.succeed(`Fetched outline. [revno=${revno}]\n`);

        if (outline.objective) {
          const table = new Table();
          table.cell('is_maximization', outline.objective.isMaximization);
          table.newRow();
          display('\n# Objective\n\n' + table.printTransposed());
        } else {
          display('\n# No objective');
        }

        const {constraints, dimensions, parameters, variables} = outline;
        if (dimensions.length) {
          const table = new Table();
          for (const dim of dimensions) {
            table.cell('label', dim.label);
            table.cell('numeric', dim.isNumeric);
            table.newRow();
          }
          display('\n# Dimensions\n\n' + table);
        } else {
          display('\n# No dimensions');
        }
        if (parameters.length) {
          const table = new Table();
          for (const param of parameters) {
            table.cell('label', param.label);
            table.cell('integral', param.isIntegral);
            table.cell('bounds', `[${param.lowerBound}, ${param.upperBound}]`);
            table.cell('rank', param.bindings.length);
            table.cell(
              'bindings',
              param.bindings.map(formatBinding).join(', ')
            );
            table.newRow();
          }
          display('\n# Parameters\n\n' + table);
        } else {
          display('\n# No parameters');
        }
        if (constraints.length) {
          const table = new Table();
          for (const constraint of constraints) {
            table.cell('label', constraint.label);
            table.cell('rank', constraint.bindings.length);
            table.cell(
              'bindings',
              constraint.bindings.map(formatBinding).join(', ')
            );
            table.newRow();
          }
          display('\n# Constraints\n\n' + table);
        } else {
          display('\n# No constraints');
        }
        if (variables.length) {
          const table = new Table();
          for (const variable of variables) {
            table.cell('label', variable.label);
            table.cell('integral', variable.isIntegral);
            table.cell(
              'bounds',
              `[${variable.lowerBound}, ${variable.upperBound}]`
            );
            table.cell('rank', variable.bindings.length);
            table.cell(
              'bindings',
              variable.bindings.map(formatBinding).join(', ')
            );
            table.newRow();
          }
          display('\n# Variables\n\n' + table);
        } else {
          display('\n# No variables');
        }
      })
    );
}

function listFormulationsCommand(): Command {
  return newCommand()
    .command('list')
    .description('list formulations')
    .option('-d, --display-name <like>', 'display name filter')
    .option('-l, --limit <limit>', 'maximum number of results', '' + PAGE_LIMIT)
    .action(
      contextualAction(async function (opts) {
        const {client, spinner} = this;
        spinner.start('Fetching formulations...');
        const table = new Table();
        const limit = +opts.limit;
        let count = 0;
        let cursor: string | undefined;
        do {
          const paginated = await client.paginateFormulations({
            first: Math.min(PAGE_LIMIT, limit - count),
            after: cursor,
            filter: {
              displayNameLike: opts.displayName,
            },
          });
          for (const node of paginated.nodes) {
            table.cell('name', node.displayName);
            table.cell(
              'created',
              DateTime.fromISO(node.createdAt).toRelative()
            );
            table.cell(
              'updated',
              DateTime.fromISO(node.lastSpecifiedAt).toRelative()
            );
            table.cell('specifications', node.specifications.totalCount);
            table.cell('url', client.formulationUrl(node.name));
            table.newRow();
          }
          const {hasNextPage, endCursor} = paginated.info;
          cursor = hasNextPage ? endCursor : undefined;
          count += paginated.nodes.length;
          spinner.text =
            `Fetched ${count} of ${paginated.totalCount} ` + 'formulations...';
        } while (cursor && count < limit);
        spinner.succeed(`Fetched ${count} formulation(s).\n`);
        display('' + table);
      })
    );
}

function deleteFormulationCommand(): Command {
  return newCommand()
    .command('delete <name>')
    .description('delete a formulation')
    .action(
      contextualAction(async function (name) {
        const {client, spinner} = this;
        spinner.start('Deleting formulation...');
        const deleted = await client.deleteFormulation(name);
        if (deleted) {
          spinner.succeed('Formulation deleted.');
        } else {
          spinner.warn('No formulation matching this name was found.');
        }
      })
    );
}

function registerSpecificationCommand(): Command {
  return newCommand()
    .command('register <path...>')
    .description('add a new specification')
    .option(
      '-f, --formulation <name>',
      'formulation name, defaults to the trimmed source\'s file name'
    )
    .option('-d, --description <text>', 'description text, defaults to source')
    .option('-t, --tags <names>', 'comma-separated tag names')
    .action(
      contextualAction(async function (srcPaths, opts) {
        const {client, spinner} = this;
        spinner.start('Reading sources...');
        const srcs = await Promise.all(
          srcPaths.map((p: string) => readFile(p, 'utf8'))
        );
        spinner
          .succeed(`Read ${srcs.length} sources.`)
          .start('Registering specification...');
        const spec = await client.registerSpecification({
          formulationName: opts.formulation ?? path.parse(srcPaths[0]).name,
          sources: srcs,
          description: opts.description ?? srcs.join('\n\n'),
          tagNames: opts.tags?.split(','),
        });
        const url = client.specificationUrl(spec.formulation.name, spec.revno);
        spinner.succeed('Registered specification: ' + url);
      })
    );
}

const DEBOUNCE_MS = 250;

enum ErrorFormat {
  ESLINT = 'eslint',
  JSON = 'json',
  PRETTY = 'pretty',
}

function validateSpecification(): Command {
  return newCommand()
    .command('validate <path...>')
    .description('validate a specification\'s sources')
    .option(
      '-f, --format <format>',
      'error output format (supported values: ' +
        `${Object.values(ErrorFormat).join(', ')})`,
      'pretty'
    )
    .option('-w, --watch', 'revalidate as sources change')
    .action(
      contextualAction(async function (srcPaths, opts) {
        const {client, spinner} = this;
        const watching = !!opts.watch;
        const format = errorFormatter(opts.format, srcPaths);

        if (!watching) {
          const valid = await validate();
          if (!valid) {
            process.exitCode = 2;
          }
          return;
        }
        await validate();
        const watcher = watch(srcPaths);
        watcher.on('change', debounce(validate, DEBOUNCE_MS));

        async function validate(): Promise<boolean> {
          if (watching) {
            console.clear();
          }
          spinner.start('Validating sources...');
          const srcs = await Promise.all(
            srcPaths.map((p: string) => readFile(p, 'utf8'))
          );
          const {slices, errors} = await client.parseSources(...srcs);
          if (!errors.length) {
            spinner.succeed(
              `Specification is valid. [definitions=${slices.length}]`
            );
            return true;
          }
          spinner.warn(
            `Specification is invalid. [definitions=${slices.length}, ` +
              `errors=${errors.length}]`
          );
          for (const slice of errors) {
            const {index} = slice;
            const src = check.isPresent(srcs[index]);
            display(format({slice, source: src}));
          }
          return false;
        }
      })
    );
}

type ErrorFormatter = (args: {
  readonly slice: api.ErrorSourceSlice;
  readonly source: string;
}) => string;

function errorFormatter(
  fmt: string,
  fps: ReadonlyArray<string>
): ErrorFormatter {
  switch (fmt) {
    case ErrorFormat.ESLINT:
      return (args): string => {
        const {code, index, message, range} = args.slice;
        const fp = check.isPresent(fps[index]);
        const {column: col, line} = range.start;
        return `${fp}: line ${line}, col ${col}, Error - ${message} [${code}]`;
      };
    case ErrorFormat.JSON:
      return (args): string => JSON.stringify(args.slice);
    case ErrorFormat.PRETTY: {
      return (args): string => {
        const {slice, source} = args;
        const fp = check.isPresent(fps[slice.index]);
        const preview = errorPreview({slice, source});
        return `\n${fp}: ${slice.message}\n${preview}`;
      };
    }
    default:
      throw errors.invalid({message: `Invalid format: ${fmt}`});
  }
}

function errorPreview(args: {
  readonly slice: api.ErrorSourceSlice;
  readonly source: string;
}): string {
  const {start, end} = args.slice.range;
  return codeFrameColumns(
    args.source,
    {start, end: {line: end.line, column: end.column + 1}},
    {
      linesAbove: 1,
      linesBelow: 1,
      message: args.slice.code,
    }
  );
}

function formatBinding(b: api.SourceBinding): string {
  return (b.dimensionLabel ?? '#') + (b.qualifier ? ` (${b.qualifier})` : '');
}

function shareFormulationCommand(): Command {
  return newCommand()
    .command('share <name>')
    .description('start sharing a formulation')
    .requiredOption('-t, --tag <name>', 'tag name to share')
    .action(
      contextualAction(async function (name, opts) {
        const {client, spinner} = this;
        spinner.start('Sharing formulation...');
        const tag = await client.shareFormulation({
          name,
          tagName: opts.tag,
        });
        const {hubUrl} = client.blueprintUrls(tag.sharedVia);
        spinner.succeed('Shared formulation: ' + hubUrl);
      })
    );
}

function unshareFormulationCommand(): Command {
  return newCommand()
    .command('unshare <name>')
    .description('stop sharing a formulation')
    .option(
      '-t, --tags <names>',
      'comma-separated names to unshare, defaults to all'
    )
    .action(
      contextualAction(async function (name, opts) {
        const {client, spinner} = this;
        spinner.start('Unsharing formulation...');
        await client.unshareFormulation({
          name,
          tagNames: opts.tags ? opts.tags.split(',') : undefined,
        });
        spinner.succeed('Unshared formulation.');
      })
    );
}
