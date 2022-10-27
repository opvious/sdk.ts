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

import {ifPresent} from '../common';
import {
  BySheet,
  Columns,
  ColumnsPatch,
  Range,
  SheetName,
  Spreadsheet,
  Value,
} from './common';

/** In-memory spreadsheet implementation. */
export class InMemorySpreadsheet implements Spreadsheet {
  private constructor(private readonly bySheet: Map<SheetName, Value[][]>) {
    this.trimColumns();
  }

  static forColumns(arg: BySheet<Columns>): Spreadsheet {
    const bySheet = new Map<SheetName, Value[][]>();
    for (const [sheet, cols] of Object.entries(arg)) {
      bySheet.set(
        sheet,
        cols.map((c) => [...c])
      );
    }
    return new InMemorySpreadsheet(bySheet);
  }

  static forCsvs(arg: BySheet<string>): Spreadsheet {
    const bySheet = new Map<SheetName, Value[][]>();
    for (const [sheet, csv] of Object.entries(arg)) {
      const rows = csv
        .trim()
        .split('\n')
        .map((r) => r.split(','));
      const width = Math.max(...rows.map((r) => r.length));
      const cols = Array.from<unknown, Value[]>({length: width}, () => []);
      for (const row of rows) {
        for (let j = 0; j < width; j++) {
          const val = row[j]?.trim() ?? '';
          const num = val === '' ? NaN : +val;
          cols[j]!.push(isNaN(num) ? val : num);
        }
      }
      bySheet.set(sheet, cols);
    }
    return new InMemorySpreadsheet(bySheet);
  }

  activeSheets(): ReadonlyArray<SheetName> {
    return [...this.bySheet.keys()];
  }

  readColumns(rgs: ReadonlyArray<Range>): ReadonlyArray<Columns> {
    const ret: Columns[] = [];
    for (const rg of rgs) {
      const cols = this.sheetColumns(rg.sheet);
      const scols = cols.slice((rg.left ?? 1) - 1, rg.right);
      const tcols = scols.map((c) => c.slice((rg.top ?? 1) - 1, rg.bottom));
      trimColumns(tcols);
      ret.push(tcols);
    }
    return ret;
  }

  updateColumns(patches: ReadonlyArray<ColumnsPatch>): void {
    for (const {range: rg, columns: src} of patches) {
      const j0 = (rg.left ?? 1) - 1;
      const width = Math.min(
        ifPresent(rg.right, (s) => s - j0) ?? Infinity,
        src.length
      );
      const i0 = (rg.top ?? 1) - 1;
      const height = Math.min(
        ifPresent(rg.bottom, (s) => s - i0) ?? Infinity,
        Math.max(...src.map((c) => c.length))
      );
      const dst = this.sheetColumns(rg.sheet);
      for (let dj = 0; dj < width; dj++) {
        const j = j0 + dj;
        while (dst.length <= j) {
          dst.push([]);
        }
        const col = dst[j]!;
        while (col.length < i0) {
          col.push('');
        }
        for (let di = 0; di < height; di++) {
          col[i0 + di] = src[dj]?.[di] ?? '';
        }
      }
    }
    this.trimColumns();
  }

  private sheetColumns(sheet: SheetName): Value[][] {
    const cols = this.bySheet.get(sheet);
    if (!cols) {
      throw new Error('Sheet not found ' + sheet);
    }
    return cols;
  }

  private trimColumns(): void {
    for (const cols of this.bySheet.values()) {
      trimColumns(cols);
    }
  }
}

function trimColumns(cols: Value[][]): void {
  cols.forEach((c) => trimEnd(c, (v) => v !== ''));
  trimEnd(cols, (c) => c.length);
}

function trimEnd<V>(arr: V[], fn: (val: V) => unknown): void {
  while (arr.length && !fn(arr[arr.length - 1]!)) {
    arr.pop();
  }
}
