/// Pure helpers for the Excel-style "Create PivotTable" flow: parsing what the
/// user typed (range / location, with an optional sheet prefix), validating it,
/// picking a name for the new worksheet, and re-pointing pivots that live on a
/// sheet created this session at the real sheet once the first save phase has
/// assigned it an id. No Univer or React imports, so it is unit-testable.

import { parseRange } from '@zerofyeoffice/xlsx-gateway/domain/cell-address'

export type PivotPlacementMode = 'new' | 'existing'

export interface PivotPlacement {
  readonly mode: PivotPlacementMode
  /// Existing worksheet only: what the user typed, e.g. `B3` or `'Sales 2024'!B3`.
  readonly location: string
}

export interface SheetRef {
  readonly sheetName: string | null
  readonly address: string
}

/// Splits `Sheet1!A1:B2` / `'My Sheet'!A1` and strips `$` anchors and spaces.
export function splitSheetRef(text: string): SheetRef {
  const trimmed = text.trim()
  const bang = trimmed.lastIndexOf('!')
  let sheetName: string | null = null
  let rest = trimmed
  if (bang >= 0) {
    let name = trimmed.slice(0, bang).trim()
    rest = trimmed.slice(bang + 1)
    if (name.length >= 2 && name.startsWith("'") && name.endsWith("'")) {
      name = name.slice(1, -1).replace(/''/g, "'")
    }
    sheetName = name
  }
  return { sheetName, address: rest.replace(/\$/g, '').replace(/\s+/g, '').toUpperCase() }
}

export type RangeCheck =
  | {
      readonly ok: true
      readonly sheetName: string | null
      readonly range: string
      readonly rows: number
      readonly columns: number
    }
  | { readonly ok: false; readonly error: 'empty' | 'invalid' | 'oneRow' | 'oneCell' }

export function checkSourceRange(text: string): RangeCheck {
  const { sheetName, address } = splitSheetRef(text)
  if (address === '') return { ok: false, error: 'empty' }
  if (!address.includes(':')) {
    try {
      parseRange(address)
    } catch {
      return { ok: false, error: 'invalid' }
    }
    return { ok: false, error: 'oneCell' }
  }
  try {
    const bounds = parseRange(address)
    const rows = bounds.endRow - bounds.startRow + 1
    const columns = bounds.endColumn - bounds.startColumn + 1
    if (rows < 2) return { ok: false, error: 'oneRow' }
    return { ok: true, sheetName, range: address, rows, columns }
  } catch {
    return { ok: false, error: 'invalid' }
  }
}

export type LocationCheck =
  | {
      readonly ok: true
      readonly sheetName: string | null
      readonly cell: string
      readonly row: number
      readonly column: number
    }
  | { readonly ok: false; readonly error: 'empty' | 'invalid' }

/// A location may be a cell or a range; like Excel only its top-left cell is used.
export function checkLocation(text: string): LocationCheck {
  const { sheetName, address } = splitSheetRef(text)
  if (address === '') return { ok: false, error: 'empty' }
  try {
    const bounds = parseRange(address)
    const column = bounds.startColumn
    let label = ''
    for (let rest = column + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
      label = String.fromCharCode(65 + ((rest - 1) % 26)) + label
    }
    return {
      ok: true,
      sheetName,
      cell: `${label}${bounds.startRow + 1}`,
      row: bounds.startRow,
      column,
    }
  } catch {
    return { ok: false, error: 'invalid' }
  }
}

export interface Area {
  readonly startRow: number
  readonly startColumn: number
  readonly endRow: number
  readonly endColumn: number
}

export function cellInsideArea(row: number, column: number, area: Area): boolean {
  return (
    row >= area.startRow &&
    row <= area.endRow &&
    column >= area.startColumn &&
    column <= area.endColumn
  )
}

/// Excel proposes "Sheet2"; a name that says what it is reads better, and the
/// lowest free `PivotTableN` never collides with a user's sheet.
export function newPivotSheetName(taken: readonly string[], base = 'PivotTable'): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()))
  if (!lower.has(base.toLowerCase())) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}${n}`
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
}

/// Case-insensitive sheet lookup, the way Excel resolves a sheet reference.
export function findSheetByName<T extends { readonly name: string }>(
  sheets: readonly T[],
  name: string,
): T | undefined {
  const wanted = name.toLowerCase()
  return sheets.find((sheet) => sheet.name.toLowerCase() === wanted)
}

interface PivotWithSheets {
  readonly sheetId: string
  readonly sourceSheetId: string
}

/// After save phase one, sheets created this session have their real ids. Held
/// pivots still carry the session ids; map them through the sheet NAME (renames
/// are already folded into `added`). Returns null when any sheet cannot be
/// matched, so the caller keeps the existing "save first" refusal.
export function remapHeldPivots<T extends PivotWithSheets>(
  held: readonly T[],
  added: ReadonlyMap<string, { readonly name: string }>,
  savedSheets: readonly { readonly id: string; readonly name: string }[],
): T[] | null {
  const resolve = (sessionId: string): string | null => {
    const pending = added.get(sessionId)
    if (!pending) return sessionId
    const real = findSheetByName(savedSheets, pending.name)
    return real ? real.id : null
  }
  const out: T[] = []
  for (const pivot of held) {
    const sheetId = resolve(pivot.sheetId)
    const sourceSheetId = resolve(pivot.sourceSheetId)
    if (sheetId === null || sourceSheetId === null) return null
    out.push({ ...pivot, sheetId, sourceSheetId })
  }
  return out
}
