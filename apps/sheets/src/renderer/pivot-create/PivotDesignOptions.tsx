import { useI18n } from '../i18n/locale'
import type { PivotLayoutModel } from '../pivot-field-model'
import { pcText } from './strings'

/// Excel's Design > Grand Totals / Subtotals as three switches in the Fields
/// pane. Unchecking one removes those rows/columns from the baked output (and
/// writes the matching OOXML flags on save).

export function setTotals(
  model: PivotLayoutModel,
  change: Partial<NonNullable<PivotLayoutModel['totals']>>,
): PivotLayoutModel {
  const next = { ...model.totals, ...change }
  const clean = {
    ...(next.grandTotalRow === false ? { grandTotalRow: false } : {}),
    ...(next.grandTotalColumn === false ? { grandTotalColumn: false } : {}),
    ...(next.subtotals === false ? { subtotals: false } : {}),
  }
  const { totals: _drop, ...rest } = model
  return Object.keys(clean).length === 0 ? rest : { ...rest, totals: clean }
}

export function PivotDesignOptions({
  model,
  onModelChange,
}: {
  readonly model: PivotLayoutModel
  readonly onModelChange: (next: PivotLayoutModel) => void
}): React.JSX.Element {
  const { lang } = useI18n()
  const totals = model.totals ?? {}
  const hasColumns = model.columns.length > 0
  const nested = model.rows.length >= 2 || model.columns.length >= 2
  return (
    <div className="pivot-design" role="group" aria-label={pcText(lang, 'designTitle')}>
      <strong>{pcText(lang, 'designTitle')}</strong>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={totals.grandTotalRow !== false}
          onChange={(event) =>
            onModelChange(setTotals(model, { grandTotalRow: event.target.checked }))
          }
        />
        {pcText(lang, 'grandTotalRow')}
      </label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          disabled={!hasColumns}
          checked={totals.grandTotalColumn !== false}
          onChange={(event) =>
            onModelChange(setTotals(model, { grandTotalColumn: event.target.checked }))
          }
        />
        {pcText(lang, 'grandTotalColumn')}
      </label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          disabled={!nested}
          checked={totals.subtotals !== false}
          onChange={(event) => onModelChange(setTotals(model, { subtotals: event.target.checked }))}
        />
        {pcText(lang, 'subtotals')}
      </label>
    </div>
  )
}
