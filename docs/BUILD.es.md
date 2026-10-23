# Compilar y verificar

[English](BUILD.en.md) · [Inicio](../README.md)

## Requisitos

- Windows x64 y Node.js 22 LTS (22.13+) con npm.
- Acceso a npm y a las descargas oficiales de Electron durante la instalación.
- Espacio para dependencias, seis modelos OCR y la distribución de Electron.
- Para verificadores Python opcionales: Python 3, pypdf, Pillow y Poppler.
  Algunos verificadores históricos también usan pdfplumber, reportlab o numpy.

## Ejecución

```powershell
npm ci
npm run build
npm run desktop
```

`npm run dev` inicia Vite para desarrollo; las operaciones de escritorio,
almacenamiento seguro y diálogos nativos requieren Electron.

## Distribución de Windows

```powershell
npm run dist:folder
```

Genera `release/PDFReaderCO-1.49.1-Carpeta/`, con el runtime original de Electron
y la aplicación en `resources/app.asar`. Abre `Abrir PDFReaderCO.cmd`. Para
compartirla, comprime todos los archivos de esa carpeta juntos. No distribuyas
solamente `electron.exe` ni `app.asar`.

`npm run dist` ofrece los objetivos NSIS y portátil de electron-builder. Su
ejecución puede depender de las políticas del equipo; la distribución en carpeta
es el formato validado. No se configura firma Authenticode.

GitHub Actions compila y publica el ZIP de Windows desde
`.github/workflows/release-windows.yml`, al modificar ese flujo o `package.json`
en `main`, o al ejecutarlo manualmente. Ejecuta las pruebas del motor y cinco
flujos de idioma, verifica el paquete y sus idiomas OCR, y comprueba cada archivo
del ZIP. El trabajo de publicación utiliza el token temporal de GitHub; no pide
claves personales. Una versión existente no se sobrescribe: aumenta la versión
de `package.json` y su lockfile para publicar una nueva entrega.

Para preparar el ZIP localmente después de `npm run dist:folder`:

```powershell
./scripts/package-release.ps1
```

Genera el ZIP, SHA-256 y notas bilingües en `release/github-assets/`.

## Pruebas

```powershell
npm test
npm run build
npm run dist:folder
node scripts/verify-app.mjs
node scripts/test-packaged.mjs --folder tests/localization.spec.ts
```

Ejecuta las pruebas de interfaz de los flujos que modifiques. `npm run test:ui`
ejecuta la suite de Playwright. Los escenarios usan documentos sintéticos y
perfiles de prueba; las pruebas de IA simulan respuestas de los proveedores.
No configures claves reales para ejecutar las pruebas.

Los verificadores Python se ejecutan después de generar sus muestras con las
pruebas correspondientes. No son necesarios para iniciar la aplicación. Buscan
`pdftoppm` en `PATH`; puedes indicar una ruta explícita:

```powershell
$env:PDFREADERCO_PDFTOPPM = 'C:\Herramientas\poppler\bin\pdftoppm.exe'
python scripts/verify-localization.py
```

`node_modules`, `dist`, `release`, perfiles, resultados e historiales locales
quedan fuera de Git. Las dependencias y modelos se obtienen mediante `npm ci`
y se copian al compilar. Conserva `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`
y los avisos de terceros al redistribuir.
