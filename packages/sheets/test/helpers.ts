import * as g from 'opvious-graph';

import {InMemorySpreadsheet, Spreadsheet} from '../src/spreadsheet';
import {identifyTables, Table} from '../src/table';

export const SHEET = 's1';

export function extractTables(csv: string): ReadonlyArray<Table> {
  const ss = InMemorySpreadsheet.forCsvs({[SHEET]: csv});
  return extractTablesFromDefaultSheet(ss);
}

export function extractTablesFromDefaultSheet(
  ss: Spreadsheet
): ReadonlyArray<Table> {
  const [cols] = ss.readColumns([{sheet: SHEET, bottom: 2}]);
  return identifyTables({[SHEET]: cols!});
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
