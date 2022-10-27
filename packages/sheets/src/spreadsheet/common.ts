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

import {assert, ifPresent} from '../common';

/** Column-oriented spreadsheet interface. */
export interface Spreadsheet {
  /** Returns all sheets in the spreadsheet. */
  activeSheets(): ReadonlyArray<SheetName>;

  /**
   * Returns columns matching the input ranges. The returned array is guaranteed
   * to have the same number of elements as the input.
   */
  readColumns(rgs: ReadonlyArray<Range>): ReadonlyArray<Columns>;

  /** Updates spreadsheet values. */
  updateColumns(patches: ReadonlyArray<ColumnsPatch>): void;
}

export interface Range {
  readonly sheet: SheetName;
  readonly top?: RowSeqno;
  readonly bottom?: RowSeqno;
  readonly left?: ColumnSeqno;
  readonly right?: ColumnSeqno;
}

export type A1 = string;

export function rangeA1(rg: Range): A1 {
  const ln = columnSeqnoToName(rg.left ?? 1);
  const rn = ifPresent(rg.right, (s) => columnSeqnoToName(s)) ?? 'ZZZ';
  return `'${rg.sheet}'!${ln}${rg.top ?? 1}:${rn}${rg.bottom ?? ''}`;
}

function columnSeqnoToName(seqno: ColumnSeqno): string {
  assert(seqno > 0);
  let ret = '';
  let rem: number;
  while (seqno > 0) {
    rem = (seqno - 1) % 26;
    ret = String.fromCharCode(rem + 65) + ret;
    seqno = (seqno - rem - 1) / 26;
  }
  return ret;
}

export type SheetName = string;

export interface BySheet<C> {
  readonly [sheet: SheetName]: C;
}

export type RowSeqno = number;

export type ColumnSeqno = number;

export type Value = string | number;

export function toValue(arg: unknown): Value {
  if (arg == null) {
    return '';
  }
  switch (typeof arg) {
    case 'number':
      return arg;
    case 'string': {
      const num = +arg;
      return isNaN(num) ? arg : num;
    }
    default:
      throw new Error('Unsupported value ' + arg);
  }
}

export type Column = ReadonlyArray<Value>;

export function isEmptyColumn(col: Column): boolean {
  return col.every((v) => v === '');
}

export type Columns = ReadonlyArray<Column>;

export interface ColumnsPatch {
  readonly range: Range;
  readonly columns: Columns;
}
