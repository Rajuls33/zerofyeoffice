import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@zerofyeoffice/i18n'
import App from './App'
import { LocaleProvider } from './i18n/locale'
import type { UiTheme } from '../shared/ipc'
import '@zerofyeoffice/ui/tokens.css'
import '@zerofyeoffice/ui/screentip.css'
import '@zerofyeoffice/ui/ai-model-picker.css'
import '@zerofyeoffice/ui/ai-queue-strip.css'
import '@zerofyeoffice/ui/ai-usage.css'
import '@zerofyeoffice/ui/ai-skills.css'
import '@zerofyeoffice/ui/color-picker.css'
import '@zerofyeoffice/ui/dropdown.css'
import '@zerofyeoffice/ui/ribbon-collapse.css'
import '@zerofyeoffice/ui/markdown.css'
import '@zerofyeoffice/ui/ai-panel-prefs.css'
import '@zerofyeoffice/ui/ai-scope-quote.css'
import './styles.css'
import { applyAiPanelPrefs, installScreenTips } from '@zerofyeoffice/ui'

installScreenTips()

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

void (async () => {
  const [lang, theme] = await Promise.all([
    window.pdfApi.getLanguage().catch(() => 'zh' as const),
    window.pdfApi.getTheme().catch(() => 'system' as const),
  ])
  document.documentElement.lang = htmlLang(lang as Lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  window.pdfApi.onThemeChanged(applyTheme)
  await window.pdfApi
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.pdfApi?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  )
})()
