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
import {assert} from '@opvious/stl-errors';

import {isIndicator, Label, TensorOutline} from '../common';
import {A1, Range, rangeA1} from '../spreadsheet';
import {Header, newHeader, Table} from '../table';

/**
 * Associates model data with table columns. The returned mapping may be partial
 * (missing parameters and/or variables).
 */
export function computeInputMapping(
  tables: ReadonlyArray<Table>,
  out: Schema<'Outline'>
): InputMapping {
  validateNoHeaderCollisions(out);

  const reg = new ItemRangeRegistry();

  const params: TensorMapping[] = [];
  for (const tsr of out.parameters) {
    if (tsr.derivation != null) {
      // This is a derived parameter, already captured.
      continue;
    }
    const mapping = tensorMapping(tables, tsr, reg);
    if (!mapping) {
      throw new Error('parameter not found ' + tsr.label);
    }
    params.push(mapping);
  }

  const variables: TensorMapping[] = [];
  for (const tsr of out.variables) {
    const mapping = tensorMapping(tables, tsr);
    if (mapping) {
      variables.push(mapping);
    }
  }

  for (const dim of out.dimensions) {
    const {label} = dim;
    const header = newHeader(label);
    for (const t of tables) {
      const block = t.blocks.get(header);
      if (!block) {
        continue;
      }
      if (block.kind !== 'slim') {
        throw new Error('Wide dimension block ' + label);
      }
      reg.addRange(label, block.bodyRange);
    }
  }

  const mapping = {
    dimensions: out.dimensions.map((d) => ({
      label: d.label,
      isNumeric: d.isNumeric,
      itemRanges: reg.ranges(d.label),
    })),
    parameters: params,
    variables,
  };
  return mapping;
}

function tensorMapping(
  tables: ReadonlyArray<Table>,
  tsr: TensorOutline,
  reg?: ItemRangeRegistry
): TensorMapping | undefined {
  const {label} = tsr;
  let mapping: TensorMapping | undefined;
  for (const table of tables) {
    const builder = TensorMappingBuilder.ifCompatible(table, tsr, reg);
    if (!builder) {
      continue;
    }
    if (mapping) {
      throw new Error('Duplicate tensor ' + label);
    }
    mapping = builder.build();
  }
  return mapping;
}

class TensorMappingBuilder {
  private isProjected = false;
  private readonly usedBlocks = new Set<Header>();
  private constructor(
    private readonly tensor: TensorOutline,
    private valueRange: Range,
    private keyBoxes: ReadonlyMap<Header, KeyBox>,
    private readonly itemRangeRegistry?: ItemRangeRegistry
  ) {}

  static ifCompatible(
    table: Table,
    tsr: TensorOutline,
    reg?: ItemRangeRegistry
  ): TensorMappingBuilder | undefined {
    const block = table.blocks.get(newHeader(tsr.label));
    if (!block) {
      return undefined;
    }
    const keyBoxes = new Map<Header, KeyBox>([
      [block.header, {kind: 'value', range: block.bodyRange}],
    ]);
    if (block.kind === 'wide') {
      keyBoxes.set(block.nestedHeader, {kind: 'row', range: block.headRange});
    }
    for (const block of table.blocks.values()) {
      if (block.kind !== 'slim') {
        continue;
      }
      keyBoxes.set(block.header, {kind: 'column', range: block.bodyRange});
    }
    return new TensorMappingBuilder(tsr, block.bodyRange, keyBoxes, reg);
  }

  build(): TensorMapping {
    const keyBoxes: KeyBox[] = [];
    for (const binding of this.tensor.bindings) {
      keyBoxes.push(this.bindingKeyBox(binding));
    }
    return {
      label: this.tensor.label,
      keyBoxes,
      valueRange: this.isProjected ? undefined : this.valueRange,
    };
  }

  private bindingKeyBox(binding: Schema<'SourceBinding'>): KeyBox {
    const {keyBoxes, tensor, usedBlocks} = this;
    const {dimensionLabel: dim, qualifier: qual} = binding;
    if (dim == null && qual == null) {
      throw new Error('Underqualified tensor ' + tensor.label);
    }
    let header = qual ? newHeader(qual) : undefined;
    let box = header ? keyBoxes.get(header) : undefined;
    if (dim != null) {
      if (!box) {
        header = newHeader(dim);
        box = keyBoxes.get(header);
      }
    }
    if (box) {
      assert(header != null, 'Null header');
      if (usedBlocks.has(header)) {
        throw new Error('Reused binding header ' + header);
      }
      usedBlocks.add(header);
    } else {
      if (this.isProjected || !isIndicator(tensor)) {
        throw new Error('Missing binding ' + header);
      }
      this.isProjected = true;
      box = {kind: 'value', range: this.valueRange};
    }
    if (dim != null) {
      this.itemRangeRegistry?.addRange(dim, box.range);
    }
    return box;
  }
}

class ItemRangeRegistry {
  private readonly byDimension = new Map<Label, Map<A1, Range>>();

  addRange(dim: Label, rg: Range): void {
    let rgs = this.byDimension.get(dim);
    if (!rgs) {
      rgs = new Map();
      this.byDimension.set(dim, rgs);
    }
    rgs.set(rangeA1(rg), rg);
  }

  ranges(dim: Label): ReadonlyArray<Range> {
    const rgs = this.byDimension.get(dim);
    if (!rgs) {
      throw new Error('Dimension not found ' + dim);
    }
    return [...rgs.values()];
  }
}

// Mappings must be JSON-serializable.
export interface InputMapping {
  readonly dimensions: ReadonlyArray<DimensionMapping>;
  readonly parameters: ReadonlyArray<TensorMapping>;
  readonly variables: ReadonlyArray<TensorMapping>;
}

export interface DimensionMapping {
  readonly label: Label;
  readonly isNumeric: boolean;
  readonly itemRanges: ReadonlyArray<Range>;
}

export interface TensorMapping {
  readonly label: Label;
  readonly keyBoxes: ReadonlyArray<KeyBox>;
  readonly valueRange?: Range; // Can be absent for indicators.
}

export type KeyBoxKind = 'column' | 'row' | 'value';

export interface KeyBox {
  readonly kind: KeyBoxKind;
  readonly range: Range;
}

function validateNoHeaderCollisions(out: Schema<'Outline'>): void {
  const byHeader = new Map<Header, Label>();
  for (const dim of out.dimensions) {
    addLabel(dim.label);
  }
  for (const param of out.parameters) {
    addLabel(param.label);
  }
  for (const variable of out.variables) {
    addLabel(variable.label);
  }
  for (const param of out.parameters) {
    checkQualifiers(param);
  }
  for (const variable of out.variables) {
    checkQualifiers(variable);
  }

  function addLabel(next: Label): void {
    const h = newHeader(next);
    const prev = byHeader.get(h);
    if (prev) {
      throw new Error(`Header collision ${h} (${prev}, ${next})`);
    }
    byHeader.set(h, next);
  }

  function checkQualifiers(tsr: TensorOutline): void {
    const quals = new Set<Header>();
    for (const {qualifier: qual} of tsr.bindings) {
      if (!qual) {
        continue;
      }
      const h = newHeader(qual);
      if (quals.has(h) || byHeader.has(h)) {
        throw new Error('Conflicting qualifier ' + qual);
      }
      quals.add(h);
    }
  }
}
