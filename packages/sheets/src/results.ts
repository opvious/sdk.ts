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

import {Schema} from '@opvious/api/sdk';
import {assert, check} from '@opvious/stl-errors';

import {isAlmost, KeyItem} from './common';
import {InputMapping} from './inputs';
import {
  Column,
  Columns,
  ColumnsPatch,
  Range,
  Spreadsheet,
  toValue,
  Value,
} from './spreadsheet';
import {commonHeight} from './table';

export function resetResults(mapping: InputMapping, ss: Spreadsheet): void {
  const resets: Range[] = [];
  for (const {keyBoxes, valueRange} of mapping.variables) {
    const keyRgs: Range[] = [];
    let valueRg = valueRange;
    for (const {kind, range} of keyBoxes) {
      if (kind === 'value') {
        valueRg = range;
      } else if (kind === 'column') {
        keyRgs.push(range);
      }
    }
    assert(valueRg, 'Missing variable values');
    let height = 1;
    if (keyRgs.length) {
      const groups = ss.readColumns(keyRgs);
      for (const cols of groups) {
        assert(cols.length <= 1, 'Wide key column');
        height = Math.max(height, cols[0]?.length ?? 0);
      }
    }
    if (height > 0) {
      assert(valueRg.top, 'Missing range top');
      resets.push({...valueRg, bottom: valueRg.top + height - 1});
    }
  }
  ss.updateColumns(
    resets.map((r) => ({
      range: r,
      columns: constantColumns(r, ''),
    }))
  );
}

function constantColumns(rg: Range, val: Value): Value[][] {
  assert(rg.right && rg.bottom, 'Unbounded range');
  const height = rg.bottom - (rg.top ?? 1) + 1;
  const width = rg.right - (rg.left ?? 1) + 1;
  return Array.from({length: width}, () => new Array(height).fill(val));
}

export function populateResults(
  results: ReadonlyArray<Schema<'TensorResult'>>,
  mapping: InputMapping,
  ss: Spreadsheet
): void {
  const nj = new ResultInjector(ss);
  const byLabel = new Map(results.map((r) => [r.label, r]));
  for (const variable of mapping.variables) {
    const {keyBoxes, label, valueRange: valueRg} = variable;
    const result = byLabel.get(label);
    assert(result, 'Missing result for ' + label);

    let pivotIx: number | undefined;
    let valueIx: number | undefined;
    const keyRgs: Range[] = [];
    for (const [ix, box] of keyBoxes.entries()) {
      keyRgs.push(box.range);
      switch (box.kind) {
        case 'row':
          assert(pivotIx == null, 'Multi-pivot result');
          pivotIx = ix;
          break;
        case 'value':
          assert(valueIx == null, 'Multi-value result');
          valueIx = ix;
          break;
        default:
      }
    }

    if (pivotIx == null) {
      if (valueIx == null) {
        assert(valueRg, 'Missing slim value range');
        nj.injectSlimUnprojectedResult(result, keyRgs, valueRg);
      } else {
        assert(!valueRg, 'Unexpected slim value range');
        nj.injectSlimProjectedResult(result, keyRgs, valueIx);
      }
    } else if (valueIx == null) {
      assert(valueRg, 'Missing wide value range');
      nj.injectWideUnprojectedResult(result, keyRgs, pivotIx, valueRg);
    } else {
      assert(!valueRg, 'Unexpected wide value range');
      nj.injectWideProjectedResult(result, keyRgs, pivotIx, valueIx);
    }
  }
}

class ResultInjector {
  constructor(private readonly spreadsheet: Spreadsheet) {}

  injectSlimUnprojectedResult(
    result: Schema<'TensorResult'>,
    keyRgs: ReadonlyArray<Range>,
    valueRg: Range
  ): void {
    const {spreadsheet: ss} = this;

    if (!keyRgs.length) {
      assert(result.entries.length <= 1, 'Invalid scalar variable result');
      const val = result.entries[0]?.value ?? 0;
      ss.updateColumns([
        {range: valueRg, columns: [[isAlmost(val, 0) ? 0 : val]]},
      ]);
      return;
    }

    const groups = ss.readColumns(keyRgs);
    const keyCols: Column[] = [];
    for (const cols of groups) {
      assert(cols.length <= 1, 'Non-slim key column');
      keyCols.push(cols[0] ?? []);
    }

    const height = commonHeight(keyCols);
    const rixByHash = rowIndexByHash(height, keyCols);
    const values = new Array(height).fill(0);
    const appendKeys: KeyItem[][] = keyCols.map(() => []);
    for (const entry of result.entries) {
      const hash = keyHash(entry.key);
      const ix = rixByHash.get(hash);
      if (ix == null) {
        values.push(entry.value);
        for (const [kix, item] of entry.key.entries()) {
          appendKeys[kix]!.push(item);
        }
      } else if (!isAlmost(entry.value, 0)) {
        values[ix] = entry.value;
      }
    }

    const patches: ColumnsPatch[] = [
      {
        columns: [values],
        range: {
          ...valueRg,
          bottom: check.isPresent(valueRg.top) + values.length - 1,
        },
      },
    ];
    if (values.length > height) {
      for (const [ix, rg] of keyRgs.entries()) {
        patches.push({
          columns: [appendKeys[ix]!],
          range: {
            ...rg,
            top: check.isPresent(rg.top) + height,
            bottom: undefined,
          },
        });
      }
    }
    ss.updateColumns(patches);
  }

  injectSlimProjectedResult(
    result: Schema<'TensorResult'>,
    keyRgs: ReadonlyArray<Range>,
    valueIx: number
  ): void {
    const {spreadsheet: ss} = this;

    let valueRg: Range | undefined;
    const readRgs: Range[] = [];
    for (const [ix, rg] of keyRgs.entries()) {
      if (ix === valueIx) {
        valueRg = rg;
      } else {
        readRgs.push(rg);
      }
    }
    assert(valueRg, 'Missing value range');

    if (!readRgs.length) {
      assert(result.entries.length <= 1, 'Invalid scalar variable result');
      const entry = result.entries[0];
      if (entry) {
        assert(isAlmost(entry.value, 1), 'Non indicator value');
        ss.updateColumns([{range: valueRg, columns: [[entry.key[valueIx]!]]}]);
      }
      return;
    }

    const groups = ss.readColumns(readRgs);
    const keyCols: Column[] = [];
    for (const cols of groups) {
      assert(cols.length <= 1, 'Non-slim key column');
      keyCols.push(cols[0] ?? []);
    }

    const height = commonHeight(keyCols);
    keyCols.splice(valueIx, 0, []);
    const rixByHash = rowIndexByHash(height, keyCols);

    const values = new Array(height).fill('');
    const appendKeys: KeyItem[][] = keyCols.map(() => []);
    for (const {key, value} of result.entries) {
      assert(isAlmost(value, 1), 'Non indicator value');
      const partialKey: (KeyItem | undefined)[] = [...key];
      partialKey[valueIx] = undefined;
      const hash = keyHash(partialKey);
      const ix = rixByHash.get(hash);
      const val = key[valueIx];
      if (ix == null) {
        values.push(val);
        for (const [jx, item] of partialKey.entries()) {
          if (item != null) {
            appendKeys[jx]!.push(item);
          }
        }
      } else {
        values[ix] = val;
      }
    }

    const patches: ColumnsPatch[] = [
      {
        columns: [values],
        range: {
          ...valueRg,
          bottom: check.isPresent(valueRg.top) + values.length - 1,
        },
      },
    ];
    if (values.length > height) {
      for (const [ix, rg] of keyRgs.entries()) {
        patches.push({
          columns: [appendKeys[ix]!],
          range: {
            ...rg,
            top: check.isPresent(rg.top) + height,
            bottom: undefined,
          },
        });
      }
    }
    ss.updateColumns(patches);
  }

  injectWideUnprojectedResult(
    result: Schema<'TensorResult'>,
    keyRgs: ReadonlyArray<Range>,
    pivotIx: number,
    valueRg: Range
  ): void {
    const {spreadsheet: ss} = this;

    const groups = ss.readColumns(keyRgs);
    const keyCols: Column[] = [];
    const columnIndexByValue = new Map<Value, number>();
    for (const [ix, cols] of groups.entries()) {
      if (ix === pivotIx) {
        for (const [jx, col] of cols.entries()) {
          assert(col.length === 1, 'Deep pivot column');
          const val = col[0];
          assert(val != null, 'Missing pivot value');
          assert(!columnIndexByValue.has(val), 'Duplicate pivot value: ' + val);
          columnIndexByValue.set(val, jx);
        }
      } else {
        assert(cols.length <= 1, 'Non-slim key column');
        keyCols.push(cols[0] ?? []);
      }
    }

    const height = keyCols.length ? commonHeight(keyCols) : 1;
    keyCols.splice(pivotIx, 0, []);
    const rixByHash = rowIndexByHash(height, keyCols);

    const values = constantColumns(
      {...valueRg, bottom: check.isPresent(valueRg.top) + height - 1},
      0
    );
    const appendKeys: KeyItem[][] = keyCols.map(() => []);
    for (const {key, value} of result.entries) {
      const partialKey: (KeyItem | undefined)[] = [...key];
      partialKey[pivotIx] = undefined;
      const hash = keyHash(partialKey);
      const i = rixByHash.get(hash);
      const j = columnIndexByValue.get(key[pivotIx]!);
      if (j == null) {
        throw new Error('Unspecified pivot value ' + key[pivotIx]);
      }
      if (i == null) {
        for (const [jx, col] of values.entries()) {
          col.push(jx === j ? value : 0);
        }
        rixByHash.set(hash, rixByHash.size);
        for (const [ix, item] of partialKey.entries()) {
          if (item != null) {
            appendKeys[ix]!.push(item);
          }
        }
      } else {
        if (values[j]![i] !== 0) {
          throw new Error('Conflicting result entry');
        }
        if (!isAlmost(value, 0)) {
          values[j]![i] = value;
        }
      }
    }

    const patches: ColumnsPatch[] = [
      {
        columns: values,
        range: {...valueRg, bottom: undefined},
      },
    ];
    if (rixByHash.size > height) {
      for (const [ix, rg] of keyRgs.entries()) {
        patches.push({
          columns: [appendKeys[ix]!],
          range: {
            ...rg,
            top: check.isPresent(rg.top) + height,
            bottom: undefined,
          },
        });
      }
    }
    ss.updateColumns(patches);
  }

  injectWideProjectedResult(
    result: Schema<'TensorResult'>,
    keyRgs: ReadonlyArray<Range>,
    pivotIx: number,
    valueIx: number
  ): void {
    assert(pivotIx !== valueIx, 'Conflicting pivot and value indices');
    const {spreadsheet: ss} = this;

    const keyWidth = keyRgs.length;
    let valueRg: Range | undefined;
    const readRgs: Range[] = [];
    for (const [ix, rg] of keyRgs.entries()) {
      if (ix === valueIx) {
        valueRg = rg;
      } else {
        readRgs.push(rg);
      }
    }
    assert(valueRg, 'Missing value range');

    const groups = ss.readColumns(readRgs);
    const keyCols: Column[] = [];
    const columnIndexByValue = new Map<Value, number>();
    for (let ix = 0; ix < keyWidth; ix++) {
      if (ix === valueIx) {
        continue;
      }
      const cols = groups[ix < valueIx ? ix : ix - 1]!;
      if (ix === pivotIx) {
        for (const [jx, col] of cols.entries()) {
          assert(col.length === 1, 'Deep pivot column');
          const val = col[0];
          assert(val != null, 'Missing pivot value');
          assert(!columnIndexByValue.has(val), 'Duplicate pivot value: ' + val);
          columnIndexByValue.set(val, jx);
        }
      } else {
        assert(cols.length <= 1, 'Non-slim key column');
        keyCols.push(cols[0] ?? []);
      }
    }

    const height = keyCols.length ? commonHeight(keyCols) : 1;
    keyCols.splice(pivotIx, 0, []);
    keyCols.splice(valueIx, 0, []);
    const rixByHash = rowIndexByHash(height, keyCols);

    const values = constantColumns(
      {...valueRg, bottom: check.isPresent(valueRg.top) + height - 1},
      ''
    );
    const appendKeys: KeyItem[][] = keyCols.map(() => []);
    for (const {key, value} of result.entries) {
      assert(isAlmost(value, 1), 'Non indicator result');
      const partialKey: (KeyItem | undefined)[] = [...key];
      partialKey[pivotIx] = undefined;
      partialKey[valueIx] = undefined;
      const hash = keyHash(partialKey);
      const i = rixByHash.get(hash);
      const j = columnIndexByValue.get(key[pivotIx]!);
      if (j == null) {
        throw new Error('Unspecified pivot value ' + key[pivotIx]);
      }
      const val = key[valueIx]!;
      if (i == null) {
        for (const [jx, col] of values.entries()) {
          col.push(jx === j ? val : '');
        }
        rixByHash.set(hash, rixByHash.size);
        for (const [ix, item] of partialKey.entries()) {
          if (item != null) {
            appendKeys[ix]!.push(item);
          }
        }
      } else {
        if (values[j]![i] !== '') {
          throw new Error('Conflicting result entry: ' + hash);
        }
        values[j]![i] = val;
      }
    }

    const patches: ColumnsPatch[] = [
      {
        columns: values,
        range: {...valueRg, bottom: undefined},
      },
    ];
    if (rixByHash.size > height) {
      for (const [ix, rg] of keyRgs.entries()) {
        patches.push({
          columns: [appendKeys[ix]!],
          range: {
            ...rg,
            top: check.isPresent(rg.top) + height,
            bottom: undefined,
          },
        });
      }
    }
    ss.updateColumns(patches);
  }
}

type Hash = string;

function keyHash(
  key: ReadonlyArray<KeyItem | undefined>,
  safe?: boolean
): Hash {
  let values;
  if (safe) {
    values = key;
  } else {
    values = Array.from({length: key.length}, (_v, ix) => toValue(key[ix]));
  }
  return JSON.stringify(values);
}

function rowIndexByHash(height: number, cols: Columns): Map<Hash, number> {
  const byHash = new Map<Hash, number>();
  for (let i = 0; i < height; i++) {
    const key = new Array(cols.length);
    for (const [j, col] of cols.entries()) {
      key[j] = col[i] ?? '';
    }
    const hash = keyHash(key, true);
    assert(!byHash.has(hash), 'Conflicting key hash: ' + hash);
    byHash.set(hash, i);
  }
  return byHash;
}
