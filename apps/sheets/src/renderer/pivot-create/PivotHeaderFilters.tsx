import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useI18n } from '../i18n/locale'
import type { PivotHeaderAnchor } from './pivot-header-anchors'
import { pcText } from './strings'

/// A small ▾ on each row-field header cell of the pivot output (Excel's header
/// dropdown). Positions follow scrolling and zoom by re-reading the cell
/// rectangles every frame while the pane is open.

export function PivotHeaderFilters({
  rowFields,
  columnCount,
  pageCount,
  getAnchors,
  fieldLabel,
  onPick,
  onPickPage,
}: {
  /// Row field indices (outer first); a filtered level shows a filled marker.
  readonly rowFields: readonly number[]
  readonly columnCount: number
  readonly pageCount: number
  readonly getAnchors: (
    rowLevels: number,
    columnLevels: number,
    pageFields: number,
  ) => PivotHeaderAnchor[]
  readonly fieldLabel: (fieldIndex: number) => string
  readonly onPick: (fieldIndex: number) => void
  readonly onPickPage: (pageIndex: number) => void
}): React.JSX.Element | null {
  const { lang } = useI18n()
  const [anchors, setAnchors] = useState<PivotHeaderAnchor[]>([])
  // The caller passes a fresh closure each render; the frame loop reads the latest.
  const getAnchorsRef = useRef(getAnchors)
  getAnchorsRef.current = getAnchors
  useEffect(() => {
    let frame = 0
    let last = ''
    const tick = (): void => {
      const next = getAnchorsRef.current(rowFields.length, columnCount, pageCount)
      const key = next
        .map((a) => `${a.kind}${a.rowLevel}:${a.x | 0}:${a.y | 0}:${a.width | 0}`)
        .join('|')
      if (key !== last) {
        last = key
        setAnchors(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [rowFields.length, columnCount, pageCount])
  if (anchors.length === 0) return null
  return createPortal(
    <>
      {anchors.map((anchor) => {
        const fieldIndex = anchor.kind === 'page' ? 0 : rowFields[anchor.rowLevel]
        if (fieldIndex === undefined || fieldIndex < 0) return null
        const size = Math.max(14, Math.min(18, anchor.height - 4))
        return (
          <button
            key={`${anchor.kind}${anchor.rowLevel}`}
            type="button"
            className="pivot-header-filter"
            aria-label={
              anchor.kind === 'page'
                ? pcText(lang, 'filterMenu')
                : pcText(lang, 'filterButton', { name: fieldLabel(fieldIndex) })
            }
            data-tip={pcText(lang, 'filterMenu')}
            onClick={() =>
              anchor.kind === 'page' ? onPickPage(anchor.rowLevel) : onPick(fieldIndex)
            }
            style={{
              position: 'fixed',
              left: anchor.x + anchor.width - size - 2,
              top: anchor.y + (anchor.height - size) / 2,
              width: size,
              height: size,
              padding: 0,
              lineHeight: 1,
              fontSize: 10,
              cursor: 'pointer',
              zIndex: 30,
            }}
          >
            ▾
          </button>
        )
      })}
    </>,
    document.body,
  )
}
