# Funciones de PDFReaderCO

[English](FEATURES.en.md) · [Inicio](../README.md)

## Leer y navegar

Apertura de varios documentos, pestañas y arrastre de archivos. Miniaturas,
índice PDF, enlaces, búsqueda por texto o anotaciones, zoom, ajuste de página,
pantalla completa, dos páginas y vista dividida. Marcadores personales y última
posición de lectura. Tema claro/oscuro e idioma español/inglés persistente.

## Editar el contenido original

Selección de líneas, fragmentos, palabras y párrafos compatibles; cursor y
selección de caracteres, sustitución parcial y formato de fuente, tamaño,
negrita/cursiva y color. Fuentes locales compatibles, guías, movimiento con
mouse/teclado, vista previa y deshacer. Ajuste del área, expansión hacia espacio
libre comprobable y crecimiento de párrafos, con alineación, sangrías e
interlineado. Unir/separar bloques y copiar/pegar formato. Selección entre varios
bloques de una página con reemplazo automático o reparto manual.

Imágenes originales compatibles: seleccionar, mover, cambiar tamaño, girar,
sustituir, extraer y eliminar apariciones. El soporte depende de la estructura
del PDF. El programa conserva restricciones cuando no puede comprobar la
geometría, el repertorio de la fuente o el espacio. No ofrece redistribución
general de todo el documento ni edición arbitraria de cualquier PDF.

## Anotar y firmar

Resaltado por palabras o área, subrayado, tachado, lápiz, rectángulos, elipses,
texto y notas. Propiedades del objeto, selección múltiple, tiradores, giro,
alineación, distribución, copia y duplicación. Biblioteca local de sellos y
firmas visuales. Compatibilidad gradual con anotaciones externas; no todos los
tipos creados por otros lectores pueden editarse.

Las firmas son imágenes o trazos visuales; no son firmas digitales certificadas.

## Formularios

Crear, mover y ajustar campos de texto, casillas, listas y grupos de botones de
opción. Selección múltiple, duplicación, tamaños y alineación. Propiedades,
formatos, límites, revisión de respuestas y cálculos entre campos propios.
Completar campos existentes, guardar una plantilla o aplanar una copia.
Los cálculos y validaciones compatibles no constituyen un intérprete general
de JavaScript de Acrobat.

## OCR sin servicios externos

Tesseract local con español, inglés, francés, alemán, italiano y portugués.
Páginas y zonas, propuesta de regiones, opciones de resolución y disposición,
orientación, perspectiva e iluminación. Revisión editable, segunda lectura y
sugerencias, recuperación, capas propias y retirada conservadora de capas
invisibles externas compatibles. Exportar TXT, añadir capa buscable o producir
una copia de texto editable con apariencia aproximada.

Los modelos se incluyen al compilar; reconocer no requiere Internet. El OCR
puede equivocarse. La copia reconstruida no conserva todo el diseño del original.

## Organizar, comparar y exportar

Reordenar páginas por arrastre, selección múltiple, duplicación, rotación,
combinación, extracción, inserción, eliminación, recorte visual, numeración y
marcas de agua. Índice interno editable con jerarquía y administración de
adjuntos. Comparación con desplazamiento sincronizado opcional, desfase de
páginas, diferencias de texto/apariencia e informes JSON/CSV.

Compresión sin pérdida o con calidad/resolución de imágenes configurable,
vista antes/después y salida independiente. Exportación PDF, `.pdfco`, TXT,
PNG e imágenes a PDF. Extraer tablas, corregir su cuadrícula y exportar CSV/XLSX;
las tablas complejas pueden necesitar ajustes y los escaneos requieren OCR.

## Lotes, guardado y recuperación

Numeración, marcas de agua, extracción, compresión y OCR en una cola. Orden,
progreso por archivo, cancelación, reintentos e informes. Copias con nombres
únicos. Deshacer/rehacer, proyectos `.pdfco`, historial de versiones, copias
automáticas y recuperación al iniciar. Guarda y revisa una copia antes de
reemplazar un documento importante.

## Asistente IA opcional

OpenRouter, OpenAI o Claude con API key y modelo del usuario. Preguntas,
resúmenes, puntos clave, requisitos/tareas y explicaciones, con citas por página.
Vista previa de extractos antes del envío y exportación de la conversación.
Clave de sesión o almacenamiento cifrado de Windows cuando está disponible.

Se envían extractos y contexto al proveedor elegido; puede cobrar el servicio.
Las citas localizadas ayudan a revisar la respuesta, pero no garantizan su
veracidad. La selección de idioma no traduce automáticamente los PDF.
