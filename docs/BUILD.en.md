# Build and verify

[Español](BUILD.es.md) · [Home](../README.en.md)

## Requirements

- Windows x64 and Node.js 22 LTS (22.13+) with npm.
- Access to npm and official Electron downloads during installation.
- Disk space for dependencies, six OCR models and the Electron distribution.
- Optional Python verifiers: Python 3, pypdf, Pillow and Poppler.
  Some historical verifiers also use pdfplumber, reportlab or numpy.

## Run from source

```powershell
npm ci
npm run build
npm run desktop
```

`npm run dev` starts Vite for development. Desktop operations, secure storage
and native dialogs require Electron.

## Windows distribution

```powershell
npm run dist:folder
```

Creates `release/PDFReaderCO-1.49.1-Carpeta/`, containing the original Electron
runtime and the application in `resources/app.asar`. Open `Abrir PDFReaderCO.cmd`.
To share it, zip all files in that folder together. Do not distribute only
`electron.exe` or `app.asar`.

`npm run dist` also exposes electron-builder NSIS and portable targets. Execution
may depend on machine policies; the folder distribution is the validated format.
No Authenticode signing or automatic publishing is configured.

## Tests

```powershell
npm test
npm run build
npm run dist:folder
node scripts/verify-app.mjs
node scripts/test-packaged.mjs --folder tests/localization.spec.ts
```

Run UI tests for the workflows you modify. `npm run test:ui` runs the Playwright
suite. Scenarios use synthetic documents and isolated test profiles; AI tests
mock provider responses. No real API keys are needed for testing.

Python verifiers run after their corresponding tests generate sample files.
They are not required to start the application. They find `pdftoppm` on `PATH`,
or accept an explicit override:

```powershell
$env:PDFREADERCO_PDFTOPPM = 'C:\Tools\poppler\bin\pdftoppm.exe'
python scripts/verify-localization.py
```

`node_modules`, `dist`, `release`, profiles, test results and local histories are
excluded from Git. Dependencies and models are fetched by `npm ci` and copied
at build time. Preserve `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md` and all
third-party notices when redistributing.
