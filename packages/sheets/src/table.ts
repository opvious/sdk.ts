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

import {ifPresent} from '@opvious/stl-utils';
import {noCase} from 'change-case';
import {singular} from 'pluralize';
import {Opaque} from 'ts-essentials';

import {
  Columns,
  isEmptyColumn,
  Range,
  SheetName,
  Spreadsheet,
  Value,
} from './spreadsheet';

export function identifyTables(ss: Spreadsheet): ReadonlyArray<Table> {
  const tables: Table[] = [];
  for (const sheet of ss.activeSheets()) {
    const [cols] = ss.readColumns([{sheet, bottom: 2}]);
    const finder = new TableFinder(sheet, cols!);
    let table;
    while ((table = finder.findTable())) {
      tables.push(table);
    }
  }
  return tables;
}

class TableFinder {
  private index = 0;
  constructor(
    private readonly sheet: SheetName,
    private readonly columns: Columns
  ) {}

  findTable(): Table | undefined {
    this.skipEmptyColumns();
    const blocks = new Map<Header, TableBlock>();
    let top;
    while (this.index < this.columns.length) {
      const block = this.currentBlock();
      if (block) {
        if (top == null) {
          top = block.bodyRange.top;
        } else if (top !== block.bodyRange.top) {
          throw new Error('Unaligned table headers');
        }
        if (blocks.has(block.header)) {
          throw new Error('Duplicate table header ' + block.header);
        }
        blocks.set(block.header, block);
      } else {
        break;
      }
    }
    return blocks.size ? {blocks} : undefined;
  }

  private skipEmptyColumns(): void {
    while (
      this.index < this.columns.length &&
      isEmptyColumn(this.columns[this.index]!)
    ) {
      this.index++;
    }
  }

  private currentBlock(): TableBlock | undefined {
    const col = this.columns[this.index];
    if (!col || isEmptyColumn(col)) {
      return undefined;
    }
    let i = 0;
    while (col[i] === '') {
      i++;
    }
    const left = this.index + 1;
    const [header, nested] = parseTableHeader(col[i]!);
    this.index++;
    if (!nested) {
      return {
        kind: 'slim',
        header,
        bodyRange: {sheet: this.sheet, top: i + 2, left, right: left},
      };
    }
    while (
      this.index < this.columns.length &&
      this.columns[this.index]![i] === ''
    ) {
      this.index++;
    }
    const right = this.index;
    return {
      kind: 'wide',
      header,
      nestedHeader: nested,
      headRange: {sheet: this.sheet, top: i + 2, bottom: i + 2, left, right},
      bodyRange: {sheet: this.sheet, top: i + 3, left, right},
    };
  }
}

export interface Table {
  readonly blocks: ReadonlyMap<Header, TableBlock>;
}

export type TableBlock = SlimTableBlock | WideTableBlock;

export interface SlimTableBlock {
  readonly kind: 'slim';
  readonly header: Header;
  readonly bodyRange: Range;
}

// Can only be followed by other wide blocks.
export interface WideTableBlock {
  readonly kind: 'wide';
  readonly header: Header;
  readonly nestedHeader: Header;
  readonly headRange: Range;
  readonly bodyRange: Range;
}

/** Always singularized, no-cased. */
export type Header = Opaque<string, 'header'>;

const suffixParensPattern = /^([^(]+)\(([^)]+)\)$/;

export function newHeader(arg: string): Header {
  if (!arg) {
    throw new Error('Empty header');
  }
  let suffixes: ReadonlyArray<string>;
  const match = suffixParensPattern.exec(arg.trim());
  if (match) {
    arg = match[1]!;
    suffixes = words(match[2]!);
  } else {
    const ix = arg.indexOf('_');
    if (~ix) {
      suffixes = words(arg.substring(ix + 1));
      arg = arg.substring(0, ix);
    } else {
      suffixes = [];
    }
  }
  let ret = words(arg).map(singular).join(' ');
  if (suffixes.length) {
    ret += ` (${suffixes.join(' ')})`;
  }
  return ret as Header;
}

function words(arg: string): ReadonlyArray<string> {
  return noCase(arg.trim()).split(/\s+|_/);
}

function parseTableHeader(val: Value): [Header, Header | undefined] {
  if (typeof val != 'string') {
    throw new Error('Numeric header ' + val);
  }
  const [left, right] = val.split('/');
  return [newHeader(left!), ifPresent(right, (s) => newHeader(s))];
}

export function commonHeight(cols: Columns): number {
  if (!cols.length) {
    return -1;
  }
  const h = cols[0]!.length;
  for (const col of cols) {
    if (col.length !== h) {
      throw new Error('Jagged key columns');
    }
  }
  return h;
}
