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
import {ifPresent} from '@opvious/stl-utils/functions';
import {watch} from 'chokidar';
import {Command} from 'commander';
import debounce from 'debounce';
import Table from 'easy-table';
import {readFile} from 'fs/promises';
import {DateTime} from 'luxon';
import * as api from 'opvious/api';
import path from 'path';
import url from 'url';

import {display} from '../io.js';
import {contextualAction, newCommand} from './common.js';

export function formulationCommand(): Command {
  return newCommand()
    .command('formulation')
    .description('model formulation commands')
    .addCommand(registerSpecificationCommand())
    .addCommand(validateSpecification())
    .addCommand(listFormulationsCommand())
    .addCommand(listFormulationTagsCommand())
    .addCommand(fetchOutlineCommand())
    .addCommand(deleteFormulationCommand());
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
        const form = await client.fetchFormulationOutline(name, opts.tag);
        const {revno, outline} = form.tag.specification;
        spinner.succeed(`Fetched outline. [revno=${revno}]\n`);

        const {dimensions, parameters, variables, constraints, objectives} =
          outline;
        if (dimensions.length) {
          const table = new Table();
          for (const dim of dimensions) {
            table.cell('dimension', dim.label);
            table.cell('numeric', dim.isNumeric);
            table.newRow();
          }
          display('' + table);
        }
        if (parameters.length) {
          const table = new Table();
          for (const param of parameters) {
            const {image} = param;
            table.cell('parameter', param.label);
            table.cell('integral', image.isIntegral);
            table.cell('bounds', `[${image.lowerBound}, ${image.upperBound}]`);
            table.cell('rank', param.bindings.length);
            table.cell(
              'bindings',
              param.bindings.map(formatBinding).join(', ')
            );
            table.newRow();
          }
          display('' + table);
        }
        if (variables.length) {
          const table = new Table();
          for (const variable of variables) {
            const {image} = variable;
            table.cell('variable', variable.label);
            table.cell('integral', image.isIntegral);
            table.cell('bounds', `[${image.lowerBound}, ${image.upperBound}]`);
            table.cell('rank', variable.bindings.length);
            table.cell(
              'bindings',
              variable.bindings.map(formatBinding).join(', ')
            );
            table.newRow();
          }
          display('' + table);
        }
        if (constraints.length) {
          const table = new Table();
          for (const constraint of constraints) {
            table.cell('constraint', constraint.label);
            table.cell('rank', constraint.bindings.length);
            table.cell(
              'bindings',
              constraint.bindings.map(formatBinding).join(', ')
            );
            table.newRow();
          }
          display('' + table);
        }
        if (objectives.length) {
          const table = new Table();
          for (const obj of outline.objectives) {
            table.cell('objective', obj.label);
            table.cell('maximization', obj.isMaximization);
            table.cell('quadratic', obj.isQuadratic);
            table.newRow();
          }
          display('' + table);
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
            table.newRow();
          }
          const {hasNextPage, endCursor} = paginated.info;
          cursor = hasNextPage ? endCursor : undefined;
          count += paginated.nodes.length;
          spinner.text =
            `Fetched ${count} of ${paginated.totalCount} ` + 'formulations...';
        } while (cursor && count < limit);
        spinner.succeed(`Fetched ${count} formulation(s).\n`);
        if (count) {
          display('' + table);
        }
      })
    );
}

function listFormulationTagsCommand(): Command {
  return newCommand()
    .command('list-tags <name>')
    .description('list formulation tags')
    .option('-l, --limit <limit>', 'maximum number of results', '' + PAGE_LIMIT)
    .action(
      contextualAction(async function (name, opts) {
        const {client, spinner} = this;
        spinner.start('Fetching formulation tags...');
        const table = new Table();
        const limit = +opts.limit;
        let count = 0;
        let cursor: string | undefined;
        do {
          const paginated = await client.paginateFormulationTags({
            formulationName: name,
            first: Math.min(PAGE_LIMIT, limit - count),
            after: cursor,
          });
          for (const node of paginated.nodes) {
            table.cell('name', node.name);
            table.cell(
              'created',
              DateTime.fromISO(node.createdAt).toRelative()
            );
            table.cell(
              'updated',
              DateTime.fromISO(node.lastUpdatedAt).toRelative()
            );
            table.cell('revno', node.specification.revno);
            table.newRow();
          }
          const {hasNextPage, endCursor} = paginated.info;
          cursor = hasNextPage ? endCursor : undefined;
          count += paginated.nodes.length;
          spinner.text =
            `Fetched ${count} of ${paginated.totalCount} ` + 'formulations...';
        } while (cursor && count < limit);
        spinner.succeed(`Fetched ${count} tag(s).\n`);
        if (count) {
          display('' + table);
        }
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
    .command('register')
    .description(
      'add a new specification. the formulation will be created ' +
        'automatically if it doesn\'t already exist'
    )
    .argument(
      '<path...>',
      'path(s) to source files. publicly available http(s) URLs are also ' +
        'supported'
    )
    .option(
      '-f, --formulation <name>',
      'formulation name, defaults to the trimmed name of the first source file'
    )
    .option(
      '-d, --description <path>',
      'path to description file, defaults to the concatenated content of ' +
        'the source files if empty'
    )
    .option(
      '-t, --tags <names>',
      'comma-separated list of tag names to apply to the specification'
    )
    .action(
      contextualAction(async function (srcPaths, opts) {
        const {client, spinner} = this;
        spinner.start('Reading sources...');
        const srcs = await Promise.all(srcPaths.map(readSource));
        const desc = await ifPresent(opts.description, (p) =>
          readFile(p, 'utf8')
        );
        spinner
          .succeed(`Read ${srcs.length} source(s).`)
          .start('Registering specification...');
        const spec = await client.registerSpecification({
          formulationName: opts.formulation ?? path.parse(srcPaths[0]).name,
          sources: srcs,
          description: desc ?? srcs.join('\n\n'),
          tagNames: opts.tags?.split(','),
        });
        const {name} = spec.formulation;
        spinner.succeed(
          `Registered specification. [name=${name}, revno=${spec.revno}]`
        );
      })
    );
}

async function readSource(src: string): Promise<string> {
  let u;
  try {
    u = new URL(src);
  } catch (_err) {
    u = url.pathToFileURL(src);
  }
  if (u.protocol === 'file:') {
    return readFile(u, 'utf8');
  }
  const res = await fetch(u);
  return res.text();
}

const DEBOUNCE_MS = 250;

enum ErrorFormat {
  ESLINT = 'eslint',
  JSON = 'json',
  PRETTY = 'pretty',
}

function validateSpecification(): Command {
  return newCommand()
    .command('validate')
    .description('validate a specification\'s sources')
    .argument('<path...>', 'local path(s) to source files')
    .option(
      '-a, --show-all',
      'always show all errors. by default non-fatal errors are hidden when ' +
        'at least one fatal error is present'
    )
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
        const showAll = !!opts.showAll;
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
          const {slices, errors} = await client.parseSources({sources: srcs});
          if (!errors.length) {
            spinner.succeed(
              `Specification is valid. [definitions=${slices.length}]`
            );
            return true;
          }
          let fatalCount = 0;
          for (const slice of errors) {
            if (slice.isFatal) {
              fatalCount++;
            }
          }
          spinner.warn(
            `Specification is invalid. [definitions=${slices.length}, ` +
              `errors=${errors.length} (${fatalCount} fatal)]`
          );
          for (const slice of errors) {
            const {index, isFatal} = slice;
            if (!fatalCount || isFatal || showAll) {
              const src = check.isPresent(srcs[index]);
              display(format({slice, source: src}));
            }
          }
          return false;
        }
      })
    );
}

type ErrorFormatter = (args: {
  readonly slice: api.Schema<'ErrorSourceSlice'>;
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
  readonly slice: api.Schema<'ErrorSourceSlice'>;
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

function formatBinding(b: api.Schema<'SourceBinding'>): string {
  return (b.dimensionLabel ?? '#') + (b.qualifier ? ` (${b.qualifier})` : '');
}
