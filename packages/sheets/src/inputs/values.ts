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

import * as api from '@opvious/api-operations';
import {assert} from '@opvious/stl-errors';

import {isAlmost, KeyItem, Label} from '../common';
import {Column, Columns, Range, Spreadsheet, Value} from '../spreadsheet';
import {commonHeight} from '../table';
import {InputMapping, TensorMapping} from './mapping';

export type InputValues = Pick<
  api.AttemptInput,
  'dimensions' | 'parameters' | 'pinnedVariables'
>;

export function extractInputValues(
  mapping: InputMapping,
  ss: Spreadsheet
): InputValues {
  const dimInputs: api.DimensionInput[] = [];
  for (const dim of mapping.dimensions) {
    const {isNumeric, label} = dim;

    const items = new Set<KeyItem>();
    const groups = ss.readColumns(dim.itemRanges);
    for (const cols of groups) {
      for (const col of cols) {
        for (const val of col) {
          assert(val != null, 'Null dimension item');
          if (isNumeric && typeof val != 'number') {
            throw new Error('Expected only numbers for ' + label);
          }
          items.add(val);
        }
      }
    }
    dimInputs.push({label, items: [...items]});
  }

  const pgt = new TensorInputGatherer(ss, readParameter);
  const parameters = mapping.parameters.map((p) => pgt.gatherInput(p));

  const vgt = new TensorInputGatherer(ss, readVariable);
  const pins: api.PinnedVariableInput[] = [];
  for (const tensor of mapping.variables) {
    const input = vgt.gatherInput(tensor);
    if (input.entries.length) {
      pins.push(input);
    }
  }

  return {dimensions: dimInputs, parameters, pinnedVariables: pins};
}

type TensorInput = api.PinnedVariableInput;

class TensorInputGatherer {
  constructor(
    private readonly spreadsheet: Spreadsheet,
    private readonly read: (val: Value | undefined) => number | undefined
  ) {}

  gatherInput(mapping: TensorMapping): TensorInput {
    const {keyBoxes, label, valueRange: valueRg} = mapping;

    let pivotIx: number | undefined;
    let valueIx: number | undefined;
    const keyRgs: Range[] = [];
    for (const [ix, box] of keyBoxes.entries()) {
      keyRgs.push(box.range);
      switch (box.kind) {
        case 'row':
          assert(pivotIx == null, 'Multi-pivot parameter');
          pivotIx = ix;
          break;
        case 'value':
          assert(valueIx == null, 'Multi-value parameter');
          valueIx = ix;
          break;
      }
    }

    if (pivotIx == null) {
      return this.gatherSlimInput(label, keyRgs, valueRg);
    } else if (valueIx == null) {
      assert(valueRg, 'Missing unprojected value range');
      return this.gatherWideUnprojectedInput(label, keyRgs, pivotIx, valueRg);
    }
    assert(!valueRg, 'Unexpected projected value range');
    return this.gatherWideProjectedInput(label, keyRgs, pivotIx, valueIx);
  }

  private gatherSlimInput(
    label: Label,
    keyRgs: ReadonlyArray<Range>,
    valueRg?: Range
  ): TensorInput {
    if (!keyRgs.length) {
      if (!valueRg) {
        throw new Error('Empty parameter');
      }
      const [cols] = this.spreadsheet.readColumns([valueRg]);
      const val = this.read(cols![0]?.[0]);
      return {
        label,
        entries: val == null ? [] : [{key: [], value: val}],
      };
    }
    const rgs = valueRg ? [valueRg, ...keyRgs] : keyRgs;
    const groups = this.spreadsheet.readColumns(rgs);

    let valCol;
    if (valueRg) {
      const cols = groups[0]!;
      assert(cols.length <= 1, 'Non-slim value column');
      valCol = cols[0] ?? [];
    }

    const keyGroups = valueRg ? groups.slice(1) : groups;
    const keyCols: Column[] = [];
    for (const cols of keyGroups) {
      assert(cols.length <= 1, 'Non-slim key column');
      keyCols.push(cols[0] ?? []);
    }

    const height = commonHeight(keyCols);
    const entries: api.EntryInput[] = [];
    for (let i = 0; i < height; i++) {
      const value = valCol ? this.read(valCol[i]!) : 1;
      if (value != null) {
        const key = keyCols.map((c) => c[i]!);
        entries.push({key, value});
      }
    }
    return {label, entries};
  }

  private gatherWideUnprojectedInput(
    label: Label,
    keyRgs: ReadonlyArray<Range>,
    pivotIx: number,
    valueRg: Range
  ): TensorInput {
    const groups = this.spreadsheet.readColumns([valueRg, ...keyRgs]);

    const valCols = groups[0]!;
    const pivotRow: Value[] = [];
    const keyCols: Column[] = [];
    for (const [ix, cols] of groups.slice(1).entries()) {
      if (ix === pivotIx) {
        for (const col of cols) {
          assert(col.length === 1, 'Deep pivot column');
          pivotRow.push(col[0]!);
        }
      } else {
        assert(cols.length <= 1, 'Non-slim key column');
        keyCols.push(cols[0] ?? []);
      }
    }

    const keyWidth = keyRgs.length;
    const entries: api.EntryInput[] = [];
    if (keyCols.length) {
      const height = commonHeight(keyCols);
      keyCols.splice(pivotIx, 0, []);
      for (let i = 0; i < height; i++) {
        const partialKey = new Array(keyWidth);
        for (const [j, col] of keyCols.entries()) {
          partialKey[j] = col[i];
        }
        for (const [j, pivot] of pivotRow.entries()) {
          const value = this.read(valCols[j]?.[i]);
          if (value != null) {
            const key = [...partialKey];
            key[pivotIx] = pivot;
            entries.push({key, value});
          }
        }
      }
    } else {
      for (const [j, item] of pivotRow.entries()) {
        const value = this.read(valCols[j]?.[0]);
        if (value != null) {
          entries.push({key: [item], value});
        }
      }
    }
    return {label, entries};
  }

  private gatherWideProjectedInput(
    label: Label,
    keyRgs: ReadonlyArray<Range>,
    pivotIx: number,
    valueIx: number
  ): TensorInput {
    assert(pivotIx !== valueIx, 'Conflicting pivot and value indices');
    const groups = this.spreadsheet.readColumns(keyRgs);

    const pivotRow: Value[] = [];
    const keyCols: Column[] = [];
    let valCols: Columns | undefined;
    for (const [ix, cols] of groups.entries()) {
      if (ix === pivotIx) {
        for (const col of cols) {
          assert(col.length === 1, 'Deep pivot column');
          pivotRow.push(col[0]!);
        }
      } else if (ix === valueIx) {
        valCols = cols;
      } else {
        assert(cols.length <= 1, 'Non-slim key column');
        keyCols.push(cols[0] ?? []);
      }
    }
    assert(valCols, 'Missing value columns');
    assert(valCols.length <= pivotRow.length, 'Missing value columns');

    const keyWidth = keyRgs.length;
    const entries: api.EntryInput[] = [];
    if (keyCols.length) {
      const height = commonHeight(keyCols);
      keyCols.splice(pivotIx, 0, []);
      keyCols.splice(valueIx, 0, []);
      for (let i = 0; i < height; i++) {
        const partialKey = new Array(keyWidth);
        for (const [j, col] of keyCols.entries()) {
          partialKey[j] = col[i];
        }
        for (const [j, pivot] of pivotRow.entries()) {
          const item = valCols[j]?.[i] ?? '';
          if (item) {
            const key = [...partialKey];
            key[pivotIx] = pivot;
            key[valueIx] = item;
            entries.push({key, value: 1});
          }
        }
      }
    } else {
      assert(pivotIx < 2 && valueIx < 2, 'Excessive pivot or value index');
      for (const [j, pivot] of pivotRow.entries()) {
        const item = valCols[j]?.[0] ?? '';
        if (item) {
          const key = new Array(2);
          key[pivotIx] = pivot;
          key[valueIx] = item;
          entries.push({key, value: 1});
        }
      }
    }
    return {label, entries};
  }
}

function readParameter(arg: Value | undefined): number | undefined {
  const val = readNumber(arg ?? '');
  return isAlmost(val, 0) ? undefined : val;
}

function readVariable(arg: Value | undefined): number | undefined {
  return arg === '' || arg == null ? undefined : readNumber(arg);
}

function readNumber(arg: Value): number {
  const val = +arg;
  if (isNaN(val)) {
    throw new Error('Non-numeric value ' + arg);
  }
  return val;
}
