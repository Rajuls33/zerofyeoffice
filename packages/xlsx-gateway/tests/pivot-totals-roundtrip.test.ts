/** Totals options survive write -> parse (what a saved-and-reopened file shows). */
import { describe, expect, it } from 'vitest'

import { buildPivotLayout } from '../src/domain/pivot-layout'
import { parsePivotDefinition } from '../src/gateway/xlsx-pivot'
import { applyPivotAdditions, type PivotAddition } from '../src/gateway/xlsx-pivot-add'
import type { MutablePackage } from '../src/gateway/xlsx-drawing-add'

type Cell = string | number
const GRID: readonly (readonly Cell[])[] = [
  ['Region', 'Product', 'Amount'],
  ['East', 'A', 10],
  ['East', 'B', 20],
  ['West', 'A', 30],
  ['West', 'B', 40],
]

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`

function inMemoryPackage(entries: Record<string, string>): MutablePackage {
  const files = new Map(Object.entries(entries))
  return {
    paths: async () => [...files.keys()],
    has: async (path) => files.has(path),
    readText: async (path) => {
      const content = files.get(path)
      if (content === undefined) throw new Error(`missing part: ${path}`)
      return content
    },
    write: (path, content) => void files.set(path, content),
    add: (path, content) => void files.set(path, content),
    addBinary: (path, bytes) => void files.set(path, new TextDecoder().decode(bytes)),
    remove: (path) => void files.delete(path),
  }
}

function worksheetOf(grid: readonly (readonly Cell[])[]): string {
  const rows = grid
    .map((row, r) => {
      const cells = row
        .map((value, c) =>
          typeof value === 'number'
            ? `<c r="${String.fromCharCode(65 + c)}${r + 1}"><v>${value}</v></c>`
            : `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`,
        )
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
}

type BakeOp = Parameters<typeof buildPivotLayout>[1]

async function writePivotPackage(
  grid: readonly (readonly Cell[])[],
  op: BakeOp,
  totals: Parameters<typeof buildPivotLayout>[3],
): Promise<{ table: string; cache: string }> {
  const layout = buildPivotLayout(grid, op, undefined, totals)
  const addition: PivotAddition = {
    worksheetPath: 'xl/worksheets/sheet2.xml',
    sourceSheetName: 'Data',
    sourceArea: {
      startRow: 0,
      startColumn: 0,
      endRow: grid.length - 1,
      endColumn: grid[0]!.length - 1,
    },
    location: { startRow: 0, startColumn: 5, endRow: 4, endColumn: 7 },
    name: 'Pivot1',
    ...layout.definition,
  } as PivotAddition
  const pkg = inMemoryPackage({
    '[Content_Types].xml': CONTENT_TYPES,
    'xl/workbook.xml': WORKBOOK,
    'xl/_rels/workbook.xml.rels': WORKBOOK_RELS,
    'xl/worksheets/sheet1.xml': worksheetOf(grid),
  })
  await applyPivotAdditions(pkg, [addition], WORKBOOK, new Set())
  return {
    table: await pkg.readText('xl/pivotTables/pivotTable1.xml'),
    cache: await pkg.readText('xl/pivotCache/pivotCacheDefinition1.xml'),
  }
}


describe('totals round trip', () => {
  it('parses a pivot written without grand totals and subtotals', async () => {
    const { table, cache } = await writePivotPackage(
      GRID,
      { rowFields: ['Region', 'Product'], columnField: ['Product'], values: [{ field: 'Amount', agg: 'sum' }] },
      { grandTotalRow: false, grandTotalColumn: false, subtotals: false },
    )
    expect(table).toContain('colGrandTotals="0"')
    expect(table).toContain('rowGrandTotals="0"')
    const definition = parsePivotDefinition(table, cache)
    expect(definition.unsupported).toEqual([])
    expect(definition.dataFields).toHaveLength(1)
  })
})
