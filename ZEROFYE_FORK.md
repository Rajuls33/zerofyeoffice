# ZerofyeOffice — fork notes

Rebranded fork of GenOffice (Apache-2.0, Copyright 2026 Mainfunc, Inc.). Keep `LICENSE` and `NOTICE`.

## What changed
- Name, package scope (`@zerofyeoffice/*`), bundle ids, CLI, UI text and docs.
- `ee/` (proprietary Mainfunc Enterprise License) was removed; it cannot be modified or redistributed.
- Logos: the Zerofye mark (`brand/zerofye-mark.svg`) replaces every app icon, the in-app badge, the
  model-picker provider icon and the home wordmark.
- Service address: sign-in and the AI proxy use **https://zerofye.com** by default. Override with
  `ZEROFYE_BASE_URL` (http only for localhost). `GSK_BASE_URL` still works as an alias.
  The address and every host check live in `packages/ai-provider/src/service-url.ts`.
- `server/` is a reference implementation of the sign-in and proxy endpoints the app calls
  (see `server/README.md`). Until something answers at zerofye.com, sign-in fails; run it locally
  with `ZEROFYE_BASE_URL=http://localhost:8787` or use your own provider keys in Settings.

## Not renamed on purpose
- `@genspark/cli` and its `.genspark-tool-cli` config folder: a third-party MIT package. The app pins it
  to the Zerofye address, so your key is never sent to Genspark. Its Genspark-only tools (hosted search,
  image generation) are unavailable on your own server; web and image search fall back to other providers.
- Credit lines to the original authors in `NOTICE`, `README.md` and `docs/i18n/README.*.md`.

## Still to do yourself
- Replace `brand/zerofye-mark.svg` with your own logo and regenerate the icons in `apps/shell/build/`
  and `apps/docs/build/` (and the three `app-icon.png` files).
- Retake the README hero image and the help-page screenshots; they still show the old interface.
- The coloured file-type icons (W / X / P / PDF) were left as generic Office-style glyphs.
