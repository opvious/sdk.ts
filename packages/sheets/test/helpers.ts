import {Schema} from '@opvious/api/sdk';

import {TensorOutline} from '../src/common';
import {InMemorySpreadsheet} from '../src/spreadsheet';
import {identifyTables, Table} from '../src/table';

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
    isIntegral: !!indic,
    lowerBound: indic ? 0 : 'Dynamic',
    upperBound: indic ? 1 : 'Dynamic',
  };
}
