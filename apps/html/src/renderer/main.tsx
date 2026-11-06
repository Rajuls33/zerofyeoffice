import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@zerofyeoffice/i18n'
import App from './App'
import { PresentView } from './PresentView'
import { LocaleProvider } from './i18n/locale'
import type { UiTheme } from '../shared/ipc'
import { applyAiPanelPrefs, installScreenTips } from '@zerofyeoffice/ui'
import '@zerofyeoffice/ui/tokens.css'
import '@zerofyeoffice/ui/screentip.css'
import '@zerofyeoffice/ui/ai-model-picker.css'
import '@zerofyeoffice/ui/ai-queue-strip.css'
import '@zerofyeoffice/ui/ai-usage.css'
import '@zerofyeoffice/ui/ai-skills.css'
import '@zerofyeoffice/ui/dropdown.css'
import '@zerofyeoffice/ui/find-panel.css'
import '@zerofyeoffice/ui/color-picker.css'
import '@zerofyeoffice/ui/ribbon-collapse.css'
import '@zerofyeoffice/ui/ai-panel-prefs.css'
import '@zerofyeoffice/ui/ai-scope-quote.css'
import '@zerofyeoffice/ui/image-dialogs.css'
import './styles.css'

installScreenTips()

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

void (async () => {
  const [lang, theme] = await Promise.all([
    window.htmlApi.getLanguage().catch(() => 'zh' as const),
    window.htmlApi.getTheme().catch(() => 'system' as const),
  ])
  document.documentElement.lang = htmlLang(lang as Lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  window.htmlApi.onThemeChanged(applyTheme)
  await window.htmlApi
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.htmlApi?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  // a present tab/window (opened by Present → New tab) renders only its owner's preview
  const params = new URLSearchParams(location.search)
  const present = params.has('present')
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      {present ? <PresentView title={params.get('title') ?? ''} /> : <App />}
    </LocaleProvider>,
  )
})()
