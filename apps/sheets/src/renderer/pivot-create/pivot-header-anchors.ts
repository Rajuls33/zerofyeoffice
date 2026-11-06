/// Screen positions of a pivot's row-field header cells, so the Fields pane can
/// float Excel-style filter buttons over them.

import { IRenderManagerService, SHEET_VIEWPORT_KEY } from '@univerjs/engine-render'
import type { PivotActionContext } from '../pivot-actions'
import { getPivotDraft } from './pivot-draft-state'

export interface PivotHeaderAnchor {
  /// 'row' = a row-field header cell; 'page' = the item cell of a report filter.
  readonly kind: 'row' | 'page'
  /// Index into the pivot's row fields (outer first) or its report filters.
  readonly rowLevel: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/// `columnLevels` = number of column fields (each takes one header row above the data).
export function pivotHeaderAnchors(
  ctx: PivotActionContext,
  rowLevels: number,
  columnLevels: number,
  pageFields = 0,
): PivotHeaderAnchor[] {
  const runtime = ctx.univerRef.current
  const context = ctx.pivotEditContextRef.current
  if (!runtime || !context || getPivotDraft(ctx.lazyWorkbookRef.current)) return []
  const workbook = runtime.univerAPI.getActiveWorkbook()
  const worksheet = workbook?.getActiveSheet()
  if (!workbook || !worksheet || worksheet.getSheetId() !== context.targetSheetId) return []
  const host = document.getElementById('univer-container')
  if (!host) return []
  let surface: DOMRect | null = null
  for (const canvas of host.querySelectorAll('canvas')) {
    const rect = canvas.getBoundingClientRect()
    if (!surface || rect.width * rect.height > surface.width * surface.height) surface = rect
  }
  if (!surface) return []
  const viewMain = runtime.univer
    .__getInjector()
    .get(IRenderManagerService)
    .getRenderById(workbook.getId())
    ?.scene?.getViewport(SHEET_VIEWPORT_KEY.VIEW_MAIN)
  const scrollX = viewMain?.viewportScrollX ?? 0
  const scrollY = viewMain?.viewportScrollY ?? 0
  const zoom = worksheet.getZoom() || 1
  const bounds = context.relayout.oldBounds
  const headerRow = bounds.startRow + Math.max(0, columnLevels - 1)
  const grid = { left: surface.x, top: surface.y, right: surface.right, bottom: surface.bottom }
  const anchors: PivotHeaderAnchor[] = []
  const place = (kind: 'row' | 'page', index: number, row: number, column: number): void => {
    const rect = worksheet.getRange(row, column, 1, 1).getCellRect()
    const x = surface.x + (rect.x - scrollX) * zoom
    const y = surface.y + (rect.y - scrollY) * zoom
    const width = rect.width * zoom
    const height = rect.height * zoom
    // Keep only cells that are inside the visible grid.
    if (x < grid.left || x + width > grid.right || y < grid.top || y + height > grid.bottom) return
    anchors.push({ kind, rowLevel: index, x, y, width, height })
  }
  try {
    for (let level = 0; level < rowLevels; level += 1) {
      place('row', level, headerRow, bounds.startColumn + level)
    }
    // Report filters sit above the body: "Field | (All)" per row, then a blank row.
    for (let page = 0; page < pageFields; page += 1) {
      place('page', page, bounds.startRow - (pageFields + 1) + page, bounds.startColumn + 1)
    }
  } catch {
    return []
  }
  return anchors
}
