# Componentes de terceros

Third-party notices / Avisos de terceros

The original PDFReaderCO code is licensed under PolyForm Noncommercial 1.0.0.
The components listed below retain their respective licenses; the project's
noncommercial restriction does not replace those third-party grants.

Los componentes siguientes conservan sus licencias. La restricción no comercial
del código original de PDFReaderCO no sustituye sus permisos independientes.

Test fixtures / Muestras de prueba:
- Embedded Bitstream Vera font subsets in synthetic test PDFs retain the
  Bitstream Vera license in licenses/Bitstream-Vera-LICENSE.txt.
- Los subconjuntos incorporados de Bitstream Vera en PDF sintéticos de prueba
  conservan la licencia indicada arriba. Las demás muestras propias son sintéticas.

PDFReaderCO es una implementación independiente y no está afiliada a Adobe.
Adobe y Acrobat son marcas de Adobe. No se incluye código, logotipos ni recursos de Acrobat.

- PDF.js (Mozilla y colaboradores): Apache-2.0.
- @embedpdf/pdfium 2.15.1: envoltorio MIT; incluye PDFium WebAssembly con los avisos BSD y Apache-2.0 del archivo LICENSE.pdfium distribuido por el paquete. Sus dos licencias se incluyen en licenses/PDFium-LICENSE y licenses/PDFium-LICENSE.pdfium.
- pdf-lib (Andrew Dillon): MIT.
- React / React DOM (Meta y colaboradores): MIT.
- Lucide (Lucide contributors): ISC.
- Electron (Electron contributors): MIT; incluye Chromium y sus avisos en LICENSES.chromium.html en la distribución Windows.
- Vite, TypeScript y electron-builder se usan como herramientas de desarrollo.

Las licencias originales de los componentes de ejecución se copian en licenses/ al compilar.
Las fuentes y módulos de PDF.js conservan sus avisos originales en dist/pdf-assets.

OCR local desde 1.28.0:

- Tesseract.js 7.0.0 y tesseract.js-core 7.0.0: Apache-2.0; licencias en Tesseract-JS-LICENSE.md y Tesseract-Core-LICENSE.
- Modelos eng/spa de @tesseract.js-data 1.0.0, variante 4.0.0_best_int: proceden de naptha/tessdata y Tesseract; licencia Apache-2.0 en Tesseract-Data-LICENSE. Los envoltorios npm se declaran MIT; se distribuyen solo los datos de idioma.
- Leptonica, incorporada en el núcleo OCR: licencia BSD en Leptonica-LICENSE.
- El worker conserva su archivo worker.min.js.LICENSE.txt. Se incluyen además los avisos de Buffer, IEEE754, Regenerator Runtime, wasm-feature-detect, zlib.js y las dependencias JavaScript en licenses/.
- Los archivos OCR se copian sin modificar y se verifican mediante SHA-256 en dist/ocr-assets/manifest.json. El uso normal del OCR no necesita descargas ni servicios externos.

Referencias: https://github.com/naptha/tesseract.js, https://github.com/naptha/tesseract.js-core y https://github.com/naptha/tessdata.

OCR 1.35.0 añade modelos locales fra, deu, ita y por de @tesseract.js-data 1.0.0 (4.0.0_best_int), además de eng y spa. Distribuidos bajo Apache-2.0; se conserva la licencia de Tesseract y sus avisos.
