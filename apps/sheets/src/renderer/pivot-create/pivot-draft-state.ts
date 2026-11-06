/// A PivotTable that has been created (sheet chosen, source resolved) but has
/// no fields yet, like Excel's empty "PivotTable1" placeholder. The Fields pane
/// edits it; the first valid layout turns it into a real pivot. Kept in its own
/// file, with type-only imports, so pivot-actions can read it without a cycle.

import type { PivotActionContext, PivotEditSeed } from '../pivot-actions'
import { EMPTY_PIVOT_MODEL, type PivotField } from '../pivot-field-model'
import type { LazyWorkbookState } from '../univer-state'

export interface PivotDraft {
  readonly state: LazyWorkbookState
  readonly key: string
  readonly sourceSheetId: string
  readonly targetSheetId: string
  readonly sourceRange: string
  readonly targetCell: string
  readonly fields: PivotField[]
}

let current: PivotDraft | null = null

export function setPivotDraft(draft: PivotDraft | null): void {
  current = draft
}

/// True while any draft waits for fields (the Fields pane stays open for it).
export function hasPivotDraft(): boolean {
  return current !== null
}

/// The draft of this workbook session, or null (a draft never outlives a reopen).
export function getPivotDraft(state: LazyWorkbookState | null): PivotDraft | null {
  return current !== null && state !== null && current.state === state ? current : null
}

/// The Fields pane's seed while a draft is waiting for its first fields.
export function pivotDraftSeedOf(ctx: PivotActionContext): PivotEditSeed | null {
  const state = ctx.lazyWorkbookRef.current
  const draft = getPivotDraft(state)
  const workbook = ctx.univerRef.current?.univerAPI.getActiveWorkbook()
  if (!draft || workbook?.getActiveSheet()?.getSheetId() !== draft.targetSheetId) return null
  // Only the source sheet / range / fields are read from the context while a draft is open.
  ctx.pivotEditContextRef.current = {
    key: draft.key,
    sourceSheetId: draft.sourceSheetId,
    targetSheetId: draft.targetSheetId,
    sourceRange: draft.sourceRange,
    targetCell: draft.targetCell,
    fields: draft.fields,
    relayout: {
      target: { sessionName: '' },
      oldBounds: { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
      oldPageRows: 0,
    },
  }
  return {
    key: draft.key,
    fields: draft.fields,
    sourceRange: draft.sourceRange,
    targetCell: draft.targetCell,
    model: EMPTY_PIVOT_MODEL,
  }
}
