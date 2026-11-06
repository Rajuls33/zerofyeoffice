import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    // @zerofyeoffice/* workspace packages ship TS source (no build step, no
    // compiled entry point) — externalizing them makes Node's ESM loader try
    // to resolve their relative imports at runtime and fail. Bundle those;
    // externalize everything else (Electron, zod, node builtins).
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@zerofyeoffice/ai-provider',
          '@zerofyeoffice/agent-core',
          '@zerofyeoffice/ai-search',
          '@zerofyeoffice/docx-engine',
          '@zerofyeoffice/file-parse',
          '@zerofyeoffice/electron-utils',
          '@zerofyeoffice/i18n',
          '@zerofyeoffice/pptx-render',
          '@zerofyeoffice/xlsx-gateway',
        ],
      }),
    ],
  },
  preload: {
    // Sandboxed preload scripts cannot require arbitrary npm packages at
    // runtime, so the drop-open bridge must be bundled, not externalized.
    plugins: [externalizeDepsPlugin({ exclude: ['@zerofyeoffice/electron-utils'] })],
  },
  renderer: {
    plugins: [react()],
  },
})
