import { describe, expect, it } from 'vitest'
import {
  cellInsideArea,
  checkLocation,
  checkSourceRange,
  findSheetByName,
  newPivotSheetName,
  remapHeldPivots,
  splitSheetRef,
} from '../src/renderer/pivot-create/pivot-placement'
import { pcText } from '../src/renderer/pivot-create/strings'

describe('splitSheetRef', () => {
  it('handles prefixes, quotes and anchors', () => {
    expect(splitSheetRef("'My ''Q1'' Sheet'!$a$1:$d$9")).toEqual({ sheetName: "My 'Q1' Sheet", address: 'A1:D9' })
    expect(splitSheetRef('Data!b3')).toEqual({ sheetName: 'Data', address: 'B3' })
    expect(splitSheetRef(' a1 : c3 ')).toEqual({ sheetName: null, address: 'A1:C3' })
  })
})

describe('checkSourceRange', () => {
  it('accepts a header plus data range and counts it', () => {
    expect(checkSourceRange('Sales!A1:D100')).toEqual({ ok: true, sheetName: 'Sales', range: 'A1:D100', rows: 100, columns: 4 })
  })
  it('rejects empty, malformed, single cell and single row', () => {
    expect(checkSourceRange('')).toEqual({ ok: false, error: 'empty' })
    expect(checkSourceRange('A1:')).toEqual({ ok: false, error: 'invalid' })
    expect(checkSourceRange('hello')).toEqual({ ok: false, error: 'invalid' })
    expect(checkSourceRange('B2')).toEqual({ ok: false, error: 'oneCell' })
    expect(checkSourceRange('A1:D1')).toEqual({ ok: false, error: 'oneRow' })
  })
})

describe('checkLocation', () => {
  it('uses the top-left cell of a cell or range', () => {
    expect(checkLocation('c5')).toMatchObject({ ok: true, cell: 'C5', row: 4, column: 2 })
    expect(checkLocation('Out!F9:H20')).toMatchObject({ ok: true, sheetName: 'Out', cell: 'F9' })
    expect(checkLocation('AA10')).toMatchObject({ ok: true, cell: 'AA10', column: 26 })
  })
  it('rejects empty and malformed', () => {
    expect(checkLocation('  ')).toEqual({ ok: false, error: 'empty' })
    expect(checkLocation('9Z')).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('helpers', () => {
  it('detects a cell inside an area', () => {
    const area = { startRow: 0, startColumn: 0, endRow: 9, endColumn: 3 }
    expect(cellInsideArea(5, 3, area)).toBe(true)
    expect(cellInsideArea(5, 4, area)).toBe(false)
  })
  it('names the new sheet without collisions', () => {
    expect(newPivotSheetName(['Sheet1'])).toBe('PivotTable')
    expect(newPivotSheetName(['pivottable', 'PivotTable2'])).toBe('PivotTable3')
  })
  it('finds sheets case-insensitively', () => {
    expect(findSheetByName([{ name: 'Data' }], 'dATA')).toEqual({ name: 'Data' })
    expect(findSheetByName([{ name: 'Data' }], 'x')).toBeUndefined()
  })
})

describe('remapHeldPivots', () => {
  const held = [{ sheetId: 'new-1', sourceSheetId: 'sheet-1', tag: 'a' }]
  const saved = [
    { id: 'sheet-1', name: 'Data' },
    { id: 'sheet-2', name: 'PivotTable' },
  ]
  it('maps session ids to real ids by name and keeps saved ids', () => {
    const out = remapHeldPivots(held, new Map([['new-1', { name: 'pivottable' }]]), saved)
    expect(out).toEqual([{ sheetId: 'sheet-2', sourceSheetId: 'sheet-1', tag: 'a' }])
  })
  it('returns null when a session sheet is not in the saved file', () => {
    expect(remapHeldPivots(held, new Map([['new-1', { name: 'Gone' }]]), saved)).toBeNull()
  })
  it('does not mutate input', () => {
    remapHeldPivots(held, new Map([['new-1', { name: 'PivotTable' }]]), saved)
    expect(held[0]?.sheetId).toBe('new-1')
  })
})

describe('pcText', () => {
  it('falls back to English and fills params', () => {
    expect(pcText('fr', 'ok')).toBe('OK')
    expect(pcText('zh', 'ok')).toBe('确定')
    expect(pcText('en', 'fieldCount', { rows: 3, columns: 2, fields: 2 })).toContain('3 rows')
  })
})
