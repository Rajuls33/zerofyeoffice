/**
 * Design > Grand Totals / Subtotals: the bake (buildPivotLayout) drops the
 * rows/columns, and the OOXML writer records the matching flags so Excel
 * shows the same table.
 */
import { describe, expect, it } from 'vitest'

import { buildPivotLayout } from '../src/domain/pivot-layout'
import { buildPivotTableXml, type PivotAddition } from '../src/gateway/xlsx-pivot-add'

type Cell = string | number
const GRID: readonly (readonly Cell[])[] = [
  ['Region', 'Product', 'Year', 'Amount'],
  ['East', 'A', '2024', 10],
  ['East', 'B', '2024', 20],
  ['West', 'A', '2025', 30],
  ['West', 'B', '2025', 40],
]

const xml = (layout: ReturnType<typeof buildPivotLayout>): string =>
  buildPivotTableXml(1, {
    worksheetPath: 'xl/worksheets/sheet2.xml',
    sourceSheetName: 'Data',
    sourceArea: { startRow: 0, startColumn: 0, endRow: 4, endColumn: 3 },
    location: { startRow: 0, startColumn: 0, endRow: layout.height - 1, endColumn: layout.width - 1 },
    name: 'P',
    ...layout.definition,
  } as PivotAddition)

const labelsOf = (layout: ReturnType<typeof buildPivotLayout>): string[] =>
  layout.matrix.map((row) => row.map((cell) => cell ?? '').join('|'))

describe('grand total row (bottom)', () => {
  it('is present by default and removable', () => {
    const op = { rowFields: ['Region'], values: [{ field: 'Amount', agg: 'sum' as const }] }
    const on = buildPivotLayout(GRID, op)
    expect(labelsOf(on).at(-1)).toBe('Grand Total|100')
    const off = buildPivotLayout(GRID, op, undefined, { grandTotalRow: false })
    expect(labelsOf(off)).toEqual(['Region|Sum of Amount', 'East|30', 'West|70'])
    expect(off.height).toBe(on.height - 1)
    expect(off.definition.grandTotalRow).toBe(false)
    const text = xml(off)
    expect(text).toContain('colGrandTotals="0"')
    expect(text).not.toContain('t="grand"')
    expect(xml(on)).toContain('<i t="grand">')
    expect(xml(on)).not.toContain('colGrandTotals')
  })
})

describe('grand total column (right)', () => {
  const op = {
    rowFields: ['Region'],
    columnField: ['Product'],
    values: [{ field: 'Amount', agg: 'sum' as const }],
  }
  it('is removable and changes the width and colItems', () => {
    const on = buildPivotLayout(GRID, op)
    const off = buildPivotLayout(GRID, op, undefined, { grandTotalColumn: false })
    expect(off.width).toBe(on.width - 1)
    expect(labelsOf(off)[0]).not.toContain('Grand Total')
    expect(labelsOf(off).at(-1)).toBe('Grand Total|40|60')
    expect(off.definition.grandTotalColumn).toBe(false)
    const text = xml(off)
    expect(text).toContain('rowGrandTotals="0"')
    expect(text).toMatch(/<colItems count="2">/)
  })
  it('is ignored without column fields', () => {
    const layout = buildPivotLayout(
      GRID,
      { rowFields: ['Region'], values: [{ field: 'Amount', agg: 'sum' }] },
      undefined,
      { grandTotalColumn: false },
    )
    expect(layout.definition.grandTotalColumn).toBeUndefined()
  })
})

describe('subtotals', () => {
  const op = {
    rowFields: ['Region', 'Product'],
    values: [{ field: 'Amount', agg: 'sum' as const }],
  }
  it('are removable for nested row fields', () => {
    const on = buildPivotLayout(GRID, op)
    expect(labelsOf(on).filter((line) => line.includes('Subtotal'))).toHaveLength(2)
    const off = buildPivotLayout(GRID, op, undefined, { subtotals: false })
    expect(labelsOf(off).filter((line) => line.includes('Subtotal'))).toHaveLength(0)
    expect(off.height).toBe(on.height - 2)
    expect(off.definition.rowLines.every((line) => line.t === 'data')).toBe(true)
    const text = xml(off)
    expect(text).toContain('defaultSubtotal="0"')
    expect(text).not.toContain('<item t="default"/>')
    expect(xml(on)).not.toContain('defaultSubtotal')
  })
  it('are removable for nested column fields', () => {
    const colOp = {
      rowFields: ['Region'],
      columnField: ['Year', 'Product'],
      values: [{ field: 'Amount', agg: 'sum' as const }],
    }
    const on = buildPivotLayout(GRID, colOp)
    const off = buildPivotLayout(GRID, colOp, undefined, { subtotals: false })
    expect(off.width).toBeLessThan(on.width)
    expect(off.definition.colLines?.every((line) => line.t === 'data')).toBe(true)
  })
  it('all three off at once', () => {
    const layout = buildPivotLayout(
      GRID,
      { ...op, columnField: ['Year'] },
      undefined,
      { grandTotalRow: false, grandTotalColumn: false, subtotals: false },
    )
    const text = xml(layout)
    expect(text).toContain('colGrandTotals="0"')
    expect(text).toContain('rowGrandTotals="0"')
    expect(text).toContain('defaultSubtotal="0"')
    expect(labelsOf(layout).join('\n')).not.toMatch(/Grand Total|Subtotal/)
  })
})

describe('hidden members (header filter)', () => {
  const op = { rowFields: ['Region'], values: [{ field: 'Amount', agg: 'sum' as const }] }
  it('drops unticked members from the grid and records them as hidden items', () => {
    const layout = buildPivotLayout(GRID, op, undefined, {
      hiddenMembers: [{ field: 'Region', members: ['West'] }],
    })
    expect(labelsOf(layout)).toEqual(['Region|Sum of Amount', 'East|30', 'Grand Total|30'])
    expect(layout.definition.rowHiddenItems).toEqual([[1]])
    expect(layout.definition.hiddenMembers).toEqual([{ fieldIndex: 0, members: ['West'] }])
    expect(xml(layout)).toContain('<item x="1" h="1"/>')
  })
  it('works on column fields and ignores non-axis fields', () => {
    const layout = buildPivotLayout(
      GRID,
      { ...op, columnField: ['Product'] },
      undefined,
      {
        hiddenMembers: [
          { field: 'Product', members: ['B'] },
          { field: 'Year', members: ['2024'] },
        ],
      },
    )
    expect(labelsOf(layout)[0]).toBe('Region|A|Grand Total')
    expect(layout.definition.hiddenMembers).toEqual([{ fieldIndex: 1, members: ['B'] }])
  })
})
