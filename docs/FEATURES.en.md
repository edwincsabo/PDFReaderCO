# PDFReaderCO features

[Español](FEATURES.es.md) · [Home](../README.en.md)

## Reading and navigation

Multiple documents, tabs and file drag-and-drop. Thumbnails, PDF outlines,
links, text/annotation search, zoom, page fit, full screen, two-page and split
views. Personal bookmarks and reading position memory. Persistent light/dark
theme and Spanish/English interface selection.

## Original content editing

Select compatible lines, fragments, words and paragraphs; place a text cursor,
select characters, replace fragments and change font, size, bold/italic and
color. Compatible local fonts, guides, mouse/keyboard movement, preview and
undo. Adjustable areas, expansion into verified free space and paragraph growth,
alignment, indentation and line spacing. Merge/split blocks and copy/paste
formatting. Select text across multiple blocks on one page and replace it
using automatic or manual distribution.

Compatible original images: select, move, resize, rotate, replace, extract and
delete occurrences. Support depends on PDF structure. Restrictions remain when
the application cannot verify geometry, available font characters or free space.
It does not offer general whole-document reflow or arbitrary editing of every PDF.

## Annotations and signatures

Word/area highlighting, underline, strikeout, freehand drawing, rectangles,
ellipses, text and notes. Object properties, multiple selection, resize handles,
rotation, alignment, distribution, copying and duplication. Local stamp and
visual signature library. External annotation support is incremental; not every
annotation type produced by other readers is editable.

Signatures are visual images or strokes, not certificate-based digital signatures.

## Forms

Create, move and resize text fields, checkboxes, lists and radio groups. Multiple
selection, duplication, sizing and alignment. Properties, formats, limits,
response review and calculations between application-created fields. Fill
existing fields, save templates or flatten a copy. Supported calculations and
validation do not constitute a general Acrobat JavaScript interpreter.

## OCR without external services

Local Tesseract with Spanish, English, French, German, Italian and Portuguese.
Pages and regions, region proposals, resolution/layout options, orientation,
perspective and lighting correction. Editable review, second-pass recognition
and suggestions, recovery, own text layers and conservative removal of compatible
external invisible layers. Export TXT, add a searchable layer or create an
editable text copy with approximate appearance.

Models are bundled at build time; recognition does not require Internet access.
OCR may make mistakes. Reconstructed copies do not preserve the full original layout.

## Organization, comparison and export

Drag to reorder pages, multiple selection, duplication, rotation, merging,
extraction, insertion, deletion, visual cropping, page numbers and watermarks.
Editable hierarchical PDF outlines and embedded attachment management.
Comparison includes optional synchronized scrolling, page offsets, text/appearance
differences and JSON/CSV reports.

Lossless or configurable image-quality/resolution compression, before/after
preview and separate output copies. PDF, `.pdfco`, TXT and PNG export; images
to PDF. Extract tables, correct their grids and export CSV/XLSX; complex tables
may require manual corrections and scans require OCR.

## Batch processing, saving and recovery

Queue numbering, watermarks, extraction, compression and OCR. Ordering, per-file
progress, cancellation, retries and reports. Uniquely named copies. Undo/redo,
`.pdfco` projects, version history, automatic snapshots and startup recovery.
Save and review a copy before replacing an important document.

## Optional AI assistant

OpenRouter, OpenAI or Claude using the user's API key and model. Questions,
summaries, key points, requirements/tasks and explanations, with page citations.
Excerpt preview before transmission and conversation export. Session-only keys
or encrypted Windows storage when available.

Excerpts and context are sent to the chosen provider, which may charge for usage.
Located citations help review answers but do not guarantee accuracy. Interface
language selection does not automatically translate PDF content.
