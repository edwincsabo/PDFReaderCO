# PDFReaderCO

**English** · [Español](README.md) · [Features](docs/FEATURES.en.md) · [Build](docs/BUILD.en.md) · [License](LICENSE)

A **Windows x64 desktop application** for reading, editing and organizing PDFs.
Includes local OCR, forms, annotations, batch processing and an optional AI
assistant using your own API key. Available in **Spanish and English**.

**Free for noncommercial purposes.** You may modify and redistribute the project
under [PolyForm Noncommercial 1.0.0](LICENSE). This license does not authorize
commercial exploitation. Third-party components retain their
[original licenses](THIRD_PARTY_NOTICES.md).

![PDFReaderCO home screen](docs/screenshots/home-en.png)

## Features

| Area | Capabilities |
| --- | --- |
| Reading | Tabs, thumbnails, search, text selection/copy, zoom, two-page and split views, dark theme and reading position memory. |
| Editing | Edit compatible original words, fragments and paragraphs; move text, change formatting, expand into available space, find/replace and replace selections across blocks. Edit compatible original images. |
| Annotations | Highlight, underline, strike out, draw, add notes, text and shapes; move, rotate, resize, duplicate and align objects. |
| Forms | Create and fill text fields, checkboxes, lists and radio groups; formats, validation, calculations, mouse-based layout and flattened copies. |
| Local OCR | Spanish, English, French, German, Italian and Portuguese; regions, review/corrections, orientation, perspective, invisible text layers and export. |
| Pages | Drag to reorder, merge, insert, duplicate, rotate, extract, delete and crop; page numbers and watermarks. |
| Comparison | Side-by-side documents, synchronized scrolling, text/appearance differences and reports. |
| Export | PDF, editable `.pdfco` projects, TXT, PNG and tables to CSV/XLSX with an editable grid. |
| Tools | Compression profiles and preview, editable PDF outlines, attachments, printing and metadata. |
| Batch and recovery | Queues with progress, cancellation and retries; automatic snapshots, history and draft recovery. |
| Optional AI | Document questions, summaries, key points, requirements/tasks and explanations with page citations. OpenRouter, OpenAI or Claude. |

See [detailed features and limitations](docs/FEATURES.en.md).

## Getting started

**[Download for Windows x64, no installation](https://github.com/edwincsabo/PDFReaderCO/releases/latest/download/PDFReaderCO-Windows-x64.zip)**
· [All releases](https://github.com/edwincsabo/PDFReaderCO/releases)

1. Download **PDFReaderCO-Windows-x64.zip**.
2. Right-click the ZIP and select **Extract All**.
3. Double-click **Abrir PDFReaderCO.cmd** or **electron.exe**.

No Node.js installation or command-line steps are needed. This download includes
the executable and all six OCR languages. Keep all accompanying files together.

To run a Windows distribution, extract the **entire** application ZIP and open
`Abrir PDFReaderCO.cmd`. Keep all accompanying files together. A prebuilt
distribution does not require Node.js. GitHub's **Code → Download ZIP** contains
source code and must be built; it is not a runnable Windows package.

To run from source, with Windows x64 and Node.js 22 LTS (22.13+) with npm:

```powershell
npm ci
npm run build
npm run desktop
```

To create a Windows distribution:

```powershell
npm run dist:folder
```

Output: `release/PDFReaderCO-1.49.1-Carpeta/`.
Read the [build and test guide](docs/BUILD.en.md).

## Language

Open **Settings → Interface language → Español / English → Apply language**.
The change is immediate and persists after restart. PDF text, field names, notes
and drafts retain their original content.

![Interface language settings](docs/screenshots/settings-en.png)

## Forms and editing

Lay out fields directly on the page with the mouse and keep them interactive
when saving. Original editing depends on PDF structure, fonts, clipping masks
and available space; PDF pages do not reflow like Word documents.

![Form tools and synthetic text](docs/screenshots/forms-en.png)

## AI with your own API key

Open **AI Assistant → Configure AI**, choose OpenRouter, OpenAI or Claude, and
enter your API key and an account-compatible model. Prepare a query, review
the excerpts, then select **Send**. Keep the key only for the current session
or remember it encrypted on Windows when secure storage is available.

AI requires Internet access and provider charges may apply. Requests include
your question, reviewed excerpts and the conversation context shown in the
transmission preview. PDF tools and OCR run locally. Scanned PDFs need OCR
before their text can be used by the assistant. Check answers and citations.

![AI assistant with page citations](docs/screenshots/ai-en.png)

This screenshot uses a synthetic document and a mocked test response; it does
not show a live provider request or real credentials.

## Batch processing

Apply page numbers, watermarks, extraction, compression or OCR to multiple files,
with per-file results and independently named output copies.

![Batch processing queue](docs/screenshots/batch-en.png)

Screenshots show version 1.49.0 with synthetic documents. Publication 1.49.1
adds documentation and licensing without changing these workflows.

## Limitations and license

- Original editing supports compatible structures. Certain fonts, clipping masks
  or objects may prevent an operation.
- OCR can make mistakes and needs review, particularly with handwriting,
  difficult photographs and complex layouts.
- Handwritten signatures are visual marks, not certificate-based digital signatures.
- Current distributions have no project-owned Authenticode signature. Execution
  depends on the destination computer's Windows policies.
- This is an independent project, unaffiliated with Adobe or PDF Reader Pro.
  It does not include their code, graphical branding or assets.

The noncommercial license applies to this publication's original code and
covered modifications. It does not change third-party licenses or revoke
permissions already granted for earlier copies. This is **source-available
software for noncommercial use**, rather than an unrestricted open-source
license. Read [LICENSE](LICENSE), [NOTICE](NOTICE) and the
[third-party notices](THIRD_PARTY_NOTICES.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) to report bugs or propose changes.
