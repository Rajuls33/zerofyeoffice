import { describe, expect, it } from 'vitest'
import { setTotals } from '../src/renderer/pivot-create/PivotDesignOptions'
import {
  EMPTY_PIVOT_MODEL,
  hasHiddenTotals,
  modelToConfig,
  removeChip,
  setMemberFilter,
} from '../src/renderer/pivot-field-model'

describe('setTotals', () => {
  it('records only hidden totals and clears when all shown again', () => {
    const hidden = setTotals(EMPTY_PIVOT_MODEL, { grandTotalRow: false })
    expect(hidden.totals).toEqual({ grandTotalRow: false })
    const more = setTotals(hidden, { subtotals: false, grandTotalColumn: true })
    expect(more.totals).toEqual({ grandTotalRow: false, subtotals: false })
    const back = setTotals(setTotals(more, { grandTotalRow: true }), { subtotals: true })
    expect('totals' in back).toBe(false)
  })
  it('travels into the config only when something is hidden', () => {
    expect(modelToConfig(EMPTY_PIVOT_MODEL, 'A1:B2', 'D1').totals).toBeUndefined()
    const config = modelToConfig(setTotals(EMPTY_PIVOT_MODEL, { subtotals: false }), 'A1:B2', 'D1')
    expect(config.totals).toEqual({ subtotals: false })
    expect(hasHiddenTotals(config.totals)).toBe(true)
  })
})

describe('member filters (header dropdown)', () => {
  const base = { ...EMPTY_PIVOT_MODEL, rows: [0], columns: [1] }
  it('set, clear and travel into the config for axis fields only', () => {
    const filtered = setMemberFilter(base, 0, ['West'])
    expect(filtered.memberFilters).toEqual({ 0: ['West'] })
    expect(modelToConfig(filtered, 'A1:C9', 'E1').hiddenMembers).toEqual([
      { fieldIndex: 0, members: ['West'] },
    ])
    expect(setMemberFilter(filtered, 0, []).memberFilters).toBeUndefined()
    // a field that left the axes no longer filters
    const stale = setMemberFilter({ ...base, rows: [] }, 0, ['West'])
    expect(modelToConfig(stale, 'A1:C9', 'E1').hiddenMembers).toBeUndefined()
  })
  it('is dropped when the field is removed from its area', () => {
    const filtered = setMemberFilter(base, 0, ['West'])
    expect(removeChip(filtered, { area: 'rows', index: 0 }).memberFilters).toBeUndefined()
    const both = setMemberFilter(filtered, 1, ['B'])
    expect(removeChip(both, { area: 'rows', index: 0 }).memberFilters).toEqual({ 1: ['B'] })
  })
})
