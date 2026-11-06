import { useMemo, useState } from 'react'

import { useI18n } from '../i18n/locale'
import { useModalDialog } from '../modal-dialog'
import { pcText } from './strings'

/// Excel's header dropdown for one pivot field: a tick-list of its items.
/// Unticked items leave the report; "Clear Filter" ticks everything again.

export function PivotMemberFilter({
  fieldName,
  members,
  hidden,
  onApply,
  onClose,
}: {
  readonly fieldName: string
  readonly members: readonly string[]
  /// Currently unticked items.
  readonly hidden: readonly string[]
  /// Receives the unticked items (empty = no filter).
  readonly onApply: (hidden: string[]) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { lang } = useI18n()
  const tx = (
    key: Parameters<typeof pcText>[1],
    params?: Record<string, string | number>,
  ): string => pcText(lang, key, params)
  const [shown, setShown] = useState<ReadonlySet<string>>(
    () => new Set(members.filter((member) => !hidden.includes(member))),
  )
  const [search, setSearch] = useState('')
  const modal = useModalDialog(onClose)
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle === ''
      ? members
      : members.filter((member) => member.toLowerCase().includes(needle))
  }, [members, search])
  const allVisibleTicked = visible.length > 0 && visible.every((member) => shown.has(member))
  const toggle = (member: string): void => {
    const next = new Set(shown)
    if (next.has(member)) next.delete(member)
    else next.add(member)
    setShown(next)
  }
  const toggleAll = (): void => {
    const next = new Set(shown)
    for (const member of visible) {
      if (allVisibleTicked) next.delete(member)
      else next.add(member)
    }
    setShown(next)
  }
  const apply = (): void => {
    if (shown.size === 0) return
    onApply(members.filter((member) => !shown.has(member)))
    onClose()
  }
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog pivot-dialog"
        role="dialog"
        {...modal}
        aria-label={tx('filterTitle', { name: fieldName })}
        style={{ minWidth: 320 }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          modal.onKeyDown(event)
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
            event.preventDefault()
            apply()
          }
        }}
      >
        <header>{tx('filterTitle', { name: fieldName })}</header>
        <div className="dialog-grid">
          <input
            type="search"
            className="cell-input dialog-span"
            placeholder={tx('searchItems')}
            aria-label={tx('searchItems')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoFocus
          />
          <div
            className="dialog-span"
            role="group"
            style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 4 }}
          >
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={allVisibleTicked} onChange={toggleAll} />
              {tx('selectAll')}
            </label>
            {visible.map((member) => (
              <label key={member} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={shown.has(member)}
                  onChange={() => toggle(member)}
                />
                <span>{member === '' ? '(blank)' : member}</span>
              </label>
            ))}
          </div>
        </div>
        {shown.size === 0 && (
          <p className="dialog-note dialog-error" role="alert">
            {tx('needOneItem')}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="secondary"
            onClick={() => {
              onApply([])
              onClose()
            }}
          >
            {tx('clearFilter')}
          </button>
          <button className="secondary" onClick={onClose}>
            {tx('cancel')}
          </button>
          <button className="primary-action" disabled={shown.size === 0} onClick={apply}>
            {tx('ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
