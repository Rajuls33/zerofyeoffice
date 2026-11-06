/// Create PivotTable from the Excel-style dialog: resolve the source (optionally
/// on another sheet), place the output on a NEW worksheet or at a chosen cell of
/// an EXISTING one, then bake it with the same engine as before. The Fields pane
/// takes over afterwards (the caller opens it).

import { parseAddress, parseRange } from '@zerofyeoffice/xlsx-gateway/domain/cell-address'
import { journalSize } from '../edit-journal'
import { t } from '../i18n/locale'
import type { OoXmlPivotConfig } from '../pivot-field-model'
import { handleEditPivotApply, pivotFieldOptions, type PivotActionContext } from '../pivot-actions'
import { workbookStructureLocked } from '../univer-sync'
import { applyAiPivotAdd, pivotConfigToOpParts } from '../workbook-ops'
import type { PivotCreateInput } from './PivotCreateDialog'
import {
  cellInsideArea,
  checkLocation,
  checkSourceRange,
  findSheetByName,
  newPivotSheetName,
} from './pivot-placement'
import { getPivotDraft, pivotDraftSeedOf, setPivotDraft } from './pivot-draft-state'
import { pcText } from './strings'
import { getLang } from '../i18n/locale'

const tx = (key: Parameters<typeof pcText>[1], params?: Record<string, string | number>): string =>
  pcText(getLang(), key, params)

/// Headers in the typed range (0 when unreadable) — feeds the dialog's live summary.
export function countPivotFields(ctx: PivotActionContext, sourceRange: string): number {
  const workbook = ctx.univerRef.current?.univerAPI.getActiveWorkbook()
  if (!workbook) return 0
  const check = checkSourceRange(sourceRange)
  if (!check.ok) return 0
  const sheets = workbook.getSheets().map((sheet) => ({ name: sheet.getSheetName(), sheet }))
  const source =
    check.sheetName === null
      ? workbook.getActiveSheet()
      : findSheetByName(sheets, check.sheetName)?.sheet
  if (!source) return 0
  return pivotFieldOptions(ctx, check.range, source).length
}

export function createPivotFromDialog(
  ctx: PivotActionContext,
  input: PivotCreateInput,
): string | null {
  const runtime = ctx.univerRef.current
  if (!runtime) return t('appWorkbookNotReady')
  const workbook = runtime.univerAPI.getActiveWorkbook()
  const activeSheet = workbook?.getActiveSheet()
  if (!workbook || !activeSheet) return t('appOpenWorkbookFirst')
  const state = ctx.lazyWorkbookRef.current
  if (!state) return t('appOpenXlsxFirst')

  const sheets = workbook.getSheets().map((sheet) => ({ name: sheet.getSheetName(), sheet }))

  // ---- source ----
  const sourceCheck = checkSourceRange(input.sourceRange)
  if (!sourceCheck.ok) return tx('errInvalid')
  const sourceSheet =
    sourceCheck.sheetName === null
      ? activeSheet
      : findSheetByName(sheets, sourceCheck.sheetName)?.sheet
  if (!sourceSheet) return tx('errUnknownSheet', { name: sourceCheck.sheetName ?? '' })
  const sourceSheetId = sourceSheet.getSheetId()
  if (state.editJournal.sheets.added.has(sourceSheetId)) return t('appPivotOnAddedSheet')
  const fields = pivotFieldOptions(ctx, sourceCheck.range, sourceSheet)
  if (fields.length === 0) return tx('errNoFields')

  // ---- destination ----
  let targetSheet = activeSheet
  let targetCell = 'A1'
  let createSheet = false
  if (input.placement.mode === 'existing') {
    const location = checkLocation(input.placement.location)
    if (!location.ok) {
      return location.error === 'empty' ? tx('errLocationEmpty') : tx('errLocationInvalid')
    }
    const found =
      location.sheetName === null ? activeSheet : findSheetByName(sheets, location.sheetName)?.sheet
    if (!found) return tx('errUnknownSheet', { name: location.sheetName ?? '' })
    targetSheet = found
    targetCell = location.cell
    if (found.getSheetId() === sourceSheetId) {
      if (cellInsideArea(location.row, location.column, parseRange(sourceCheck.range))) {
        return tx('errLocationInSource')
      }
    }
  } else {
    if (workbookStructureLocked(state)) return tx('errLocked')
    createSheet = true
  }

  // ---- place: the sheet and an empty draft; fields come from the pane ----
  let createdSheetId: string | null = null
  try {
    if (createSheet) {
      const name = newPivotSheetName(sheets.map((entry) => entry.name))
      workbook.insertSheet(name)
      const created = workbook.getSheetByName(name)
      if (!created) return t('appSheetAddFailed')
      createdSheetId = created.getSheetId()
      targetSheet = created
    }
    const target = parseAddress(targetCell)
    workbook.setActiveSheet(targetSheet)
    targetSheet.getRange(target.row, target.column, 1, 1).activate()
    const targetSheetId = targetSheet.getSheetId()
    setPivotDraft({
      state,
      key: `draft:${targetSheetId}:${targetCell}`,
      sourceSheetId,
      targetSheetId,
      sourceRange: sourceCheck.range,
      targetCell,
      fields,
    })
    ctx.setMessage(tx('draftReady', { sheet: targetSheet.getSheetName() }))
    return null
  } catch (error) {
    if (createdSheetId !== null) {
      try {
        workbook.deleteSheet(createdSheetId)
      } catch {
        /* the sheet stays; the user can delete it */
      }
    }
    return error instanceof Error ? error.message : t('appPivotCreateFailed')
  }
}

/// Pane apply: the first valid layout of a draft creates the pivot; afterwards
/// (and for every other pivot) it is the ordinary relayout.
export function applyPivotLayout(ctx: PivotActionContext, config: OoXmlPivotConfig): string | null {
  const runtime = ctx.univerRef.current
  const state = ctx.lazyWorkbookRef.current
  const draft = getPivotDraft(state)
  if (!draft || !runtime || !state) return handleEditPivotApply(ctx, config)
  const workbook = runtime.univerAPI.getActiveWorkbook()
  const target = workbook?.getSheetBySheetId(draft.targetSheetId)
  if (!workbook || !target) return t('appOpenWorkbookFirst')
  const parts = pivotConfigToOpParts(config, draft.fields)
  if (typeof parts === 'string') return parts
  try {
    const result = applyAiPivotAdd(runtime, state, {
      op: 'add_pivot',
      sheetId: draft.sourceSheetId,
      ...(draft.targetSheetId === draft.sourceSheetId
        ? {}
        : { targetSheetId: draft.targetSheetId }),
      sourceRange: draft.sourceRange,
      targetCell: draft.targetCell,
      ...parts,
    })
    setPivotDraft(null)
    ctx.pivotEditContextRef.current = null
    workbook.setActiveSheet(target)
    target.getRange(result.location.startRow, result.location.startColumn, 1, 1).activate()
    ctx.setPendingEdits(journalSize(state.editJournal))
    ctx.setMessage(t('appPivotCreated', { cell: draft.targetCell }))
    return null
  } catch (error) {
    return error instanceof Error ? error.message : t('appPivotCreateFailed')
  }
}

/// The Fields pane's layout became invalid (every Row or every Value removed).
/// A pivot made this session goes back to the empty placeholder — its output is
/// cleared so the sheet reflects the removal, and the pane keeps the layout so
/// the next valid arrangement rebuilds it. Pivots that came from the file keep
/// their grid (they are not deleted from here).
export function resetPivotToDraft(ctx: PivotActionContext): void {
  const runtime = ctx.univerRef.current
  const state = ctx.lazyWorkbookRef.current
  const context = ctx.pivotEditContextRef.current
  if (!runtime || !state || !context || getPivotDraft(state)) return
  const target = context.relayout.target
  if (!('sessionName' in target) || target.sessionName === '') return
  const at = state.editJournal.pivotAdds.findIndex((pivot) => pivot.name === target.sessionName)
  const sheet = runtime.univerAPI.getActiveWorkbook()?.getSheetBySheetId(context.targetSheetId)
  if (at < 0 || !sheet) return
  const old = context.relayout.oldBounds
  const firstRow = old.startRow - context.relayout.oldPageRows
  sheet
    .getRange(
      firstRow,
      old.startColumn,
      old.endRow - firstRow + 1,
      old.endColumn - old.startColumn + 1,
    )
    .clearContent()
  state.editJournal.pivotAdds.splice(at, 1)
  setPivotDraft({
    state,
    key: `draft:${context.targetSheetId}:${context.targetCell}`,
    sourceSheetId: context.sourceSheetId,
    targetSheetId: context.targetSheetId,
    sourceRange: context.sourceRange,
    targetCell: context.targetCell,
    fields: context.fields,
  })
  pivotDraftSeedOf(ctx)
  ctx.setPendingEdits(journalSize(state.editJournal))
  ctx.setMessage(tx('draftReady', { sheet: sheet.getSheetName() }))
}
