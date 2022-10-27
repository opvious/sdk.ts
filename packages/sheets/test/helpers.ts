import * as g from 'opvious-graph';

import {InMemorySpreadsheet} from '../src/spreadsheet';
import {identifyTables, Table} from '../src/table';

export const SHEET = 'default';

export function extractTables(csv: string): ReadonlyArray<Table> {
  return identifyTables(InMemorySpreadsheet.forCsvs({[SHEET]: csv}));
}

export function tensorOutline(
  label: string,
  bindings: ReadonlyArray<g.SourceBinding>,
  indic?: boolean
): g.TensorOutline {
  return {
    label,
    bindings,
    isIntegral: !!indic,
    lowerBound: indic ? 0 : 'Dynamic',
    upperBound: indic ? 1 : 'Dynamic',
  };
}
