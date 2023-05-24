import {Schema} from '@opvious/api/sdk';

import {TensorOutline} from '../src/common.js';
import {InMemorySpreadsheet} from '../src/spreadsheet/index.js';
import {identifyTables, Table} from '../src/table.js';

export const SHEET = 'default';

export function extractTables(csv: string): ReadonlyArray<Table> {
  return identifyTables(InMemorySpreadsheet.forCsvs({[SHEET]: csv}));
}

export function tensorOutline(
  label: string,
  bindings: ReadonlyArray<Schema<'SourceBinding'>>,
  indic?: boolean
): TensorOutline {
  return {
    label,
    bindings,
    image: {
      isIntegral: !!indic,
      lowerBound: indic ? 0 : 'Dynamic',
      upperBound: indic ? 1 : 'Dynamic',
    },
  };
}
