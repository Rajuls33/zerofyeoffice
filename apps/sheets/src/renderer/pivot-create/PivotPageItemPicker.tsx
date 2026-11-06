import { useMemo, useState } from 'react'

import { useI18n } from '../i18n/locale'
import { useModalDialog } from '../modal-dialog'
import { pcText } from './strings'

/// Excel's report-filter dropdown: "(All)" or one item to show.

export function PivotPageItemPicker({
  fieldName,
  members,
  item,
  onApply,
  onClose,
}: {
  readonly fieldName: string
  readonly members: readonly string[]
  /// The selected item, null = (All).
  readonly item: string | null
  readonly onApply: (item: string | null) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { lang } = useI18n()
  const tx = (
    key: Parameters<typeof pcText>[1],
    params?: Record<string, string | number>,
  ): string => pcText(lang, key, params)
  const [selected, setSelected] = useState<string | null>(item)
  const [search, setSearch] = useState('')
  const modal = useModalDialog(onClose)
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle === ''
      ? members
      : members.filter((member) => member.toLowerCase().includes(needle))
  }, [members, search])
  const apply = (): void => {
    onApply(selected)
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
            role="radiogroup"
            style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 4 }}
          >
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="radio"
                name="pivot-page-item"
                checked={selected === null}
                onChange={() => setSelected(null)}
              />
              {tx('allItems')}
            </label>
            {visible.map((member) => (
              <label key={member} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="radio"
                  name="pivot-page-item"
                  checked={selected === member}
                  onChange={() => setSelected(member)}
                />
                <span>{member === '' ? '(blank)' : member}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            {tx('cancel')}
          </button>
          <button className="primary-action" onClick={apply}>
            {tx('ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
