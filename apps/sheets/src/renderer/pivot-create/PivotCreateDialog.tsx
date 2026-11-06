import { useMemo, useState } from 'react'

import { useI18n } from '../i18n/locale'
import { useModalDialog } from '../modal-dialog'
import { checkLocation, checkSourceRange, type PivotPlacement } from './pivot-placement'
import { pcText, type PivotCreateKey } from './strings'

/// Excel's "Create PivotTable" dialog: pick the data, then choose New
/// Worksheet or Existing Worksheet (+ Location). OK builds the pivot and the
/// caller opens the PivotTable Fields pane.

export interface PivotCreateInput {
  /// Exactly what the user typed (may carry a `Sheet!` prefix).
  readonly sourceRange: string
  readonly placement: PivotPlacement
}

export function PivotCreateDialog({
  sourceRange,
  onCountFields,
  onCreate,
  onClose,
}: {
  readonly sourceRange: string
  /// Number of column headers in the typed range; 0 when none can be read.
  readonly onCountFields: (sourceRange: string) => number
  /// Returns an error message, or null on success.
  readonly onCreate: (input: PivotCreateInput) => string | null
  readonly onClose: () => void
}): React.JSX.Element {
  const { lang } = useI18n()
  const tx = (key: PivotCreateKey, params?: Record<string, string | number>): string =>
    pcText(lang, key, params)
  const [source, setSource] = useState(sourceRange)
  const [mode, setMode] = useState<PivotPlacement['mode']>('new')
  const [location, setLocation] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const modal = useModalDialog(onClose)

  const sourceState = useMemo((): { error: string | null; summary: string | null } => {
    const check = checkSourceRange(source)
    if (!check.ok) {
      const key = {
        empty: 'errEmpty',
        invalid: 'errInvalid',
        oneRow: 'errOneRow',
        oneCell: 'errOneCell',
      } as const
      return { error: tx(key[check.error]), summary: null }
    }
    const fields = onCountFields(source)
    if (fields === 0) return { error: tx('errNoFields'), summary: null }
    return {
      error: null,
      summary: tx('fieldCount', { rows: check.rows, columns: check.columns, fields }),
    }
    // tx closes over lang only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, lang, onCountFields])

  const locationError =
    mode === 'existing' && location.trim() !== '' && !checkLocation(location).ok
      ? tx('errLocationInvalid')
      : null

  const canSubmit =
    sourceState.error === null &&
    (mode === 'new' || (location.trim() !== '' && locationError === null))

  const submit = (): void => {
    if (!canSubmit) return
    const failure = onCreate({ sourceRange: source, placement: { mode, location } })
    if (failure !== null) setSubmitError(failure)
    else onClose()
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="format-cells-dialog pivot-dialog"
        role="dialog"
        {...modal}
        aria-label={tx('title')}
        style={{ minWidth: 440 }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          modal.onKeyDown(event)
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
            event.preventDefault()
            submit()
          }
        }}
      >
        <header>{tx('title')}</header>
        <div className="dialog-grid">
          <p className="dialog-note dialog-span">{tx('chooseData')}</p>
          <label className="dialog-span" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="radio" checked readOnly />
            {tx('selectRange')}
          </label>
          <label style={{ paddingLeft: 24 }}>
            {tx('tableRange')}
            <input
              type="text"
              className="cell-input"
              value={source}
              aria-invalid={sourceState.error !== null}
              onChange={(event) => {
                setSource(event.target.value.toUpperCase())
                setSubmitError(null)
              }}
              style={{ width: 200 }}
              autoFocus
            />
          </label>
          {sourceState.summary && (
            <p className="dialog-note dialog-span" style={{ paddingLeft: 24 }}>
              {sourceState.summary}
            </p>
          )}
          {sourceState.error && (
            <p
              className="dialog-note dialog-error dialog-span"
              role="alert"
              style={{ paddingLeft: 24 }}
            >
              {sourceState.error}
            </p>
          )}
          <p className="dialog-note dialog-span">{tx('chooseWhere')}</p>
          <label className="dialog-span" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="radio"
              name="pivot-placement"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
            />
            {tx('newSheet')}
          </label>
          <label className="dialog-span" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="radio"
              name="pivot-placement"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
            />
            {tx('existingSheet')}
          </label>
          <label style={{ paddingLeft: 24 }}>
            {tx('location')}
            <input
              type="text"
              className="cell-input"
              placeholder={tx('locationPlaceholder')}
              value={location}
              disabled={mode !== 'existing'}
              aria-invalid={locationError !== null}
              onChange={(event) => {
                setLocation(event.target.value.toUpperCase())
                setSubmitError(null)
              }}
              style={{ width: 200 }}
            />
          </label>
          {locationError && (
            <p
              className="dialog-note dialog-error dialog-span"
              role="alert"
              style={{ paddingLeft: 24 }}
            >
              {locationError}
            </p>
          )}
        </div>
        {submitError && (
          <p className="dialog-note dialog-error" role="alert">
            {submitError}
          </p>
        )}
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            {tx('cancel')}
          </button>
          <button className="primary-action" disabled={!canSubmit} onClick={submit}>
            {tx('ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
