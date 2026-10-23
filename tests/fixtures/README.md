# Control de compatibilidad 1.3.0

`native-1.3.0.pdf` es el documento de control generado durante las pruebas finales de PDFReaderCO 1.3.0, antes de ampliar el motor a subrayado y tachado. Contiene un texto FreeText y un resaltado Highlight propios. No contiene datos del usuario.

SHA-256: `394a3038b414ec74d67a89ab2a217114c3763c9fec3e6770cd0505e7c44a183e`.

`native-1.4.0.pdf` se generó durante la validación final de 1.4.0, antes de ampliar el motor a figuras. Contiene texto, resaltado, subrayado y tachado propios, sin datos del usuario.

SHA-256: `c9630aa60eb2deffaab4f394aa852965f1e99407d9471f69dc24439cddfa778d`.

`native-1.7.0.pdf` se generó durante la validación final de 1.7.0, antes de añadir tinta nativa. Contiene los seis tipos editables anteriores, sin datos del usuario.

SHA-256: `417916c1313e30382f76b18b99964bef3151e46b2564066bb5d67cc98d12e9c6`.

`native-1.8.0.pdf` se generó durante las pruebas finales de 1.8.0, antes de añadir comentarios propios editables. Contiene los siete tipos nativos anteriores, sin datos del usuario.

SHA-256: `92e60c896e46f51e68f95a5a21905c21414b982ccbddca645a2ce8ebd99cf67e`.

`native-1.10.1.pdf` proviene de la prueba de compatibilidad de la entrega 1.10.1, antes de añadir imágenes y firmas visuales nativas. Contiene los ocho tipos anteriores, sin datos del usuario.

SHA-256: `e764e497b980765e16ba4dbbd87c0379ef4cb0ff2f17dbaa93af284bc212a98c`.

`stamp-image.png`, `stamp-photo.jpg` y `stamp-signature.png` son dibujos sintéticos de control: PNG con transparencia parcial, JPEG de colores y trazo PNG transparente. `stamp-large.png` contiene ruido determinista de prueba, con más de 256 KB. No contienen información del usuario ni recursos de otras aplicaciones.

`original-subset.pdf` se genera con ReportLab y la fuente Vera incluida en su entorno de pruebas. Contiene dos líneas sintéticas en una fuente incorporada parcialmente. Se usa para comprobar restricciones de caracteres y elección explícita de una fuente alternativa; no contiene datos personales.

SHA-256 de original-subset.pdf: e93aec5335ce0274bb177764b1c201ef84844b2348c1b12ba7bcc4d5f7b3720e.

`comparison-encrypted.pdf` es un documento sintético de una página, generado con ReportLab y pypdf, cifrado con AES-256. Contraseña de control: `lectura123`. Se usa para verificar la reutilización de un lector desbloqueado en comparación. No contiene datos personales.

SHA-256: `5747adcd7ad60da15f1f3abb4ffb321f465d03950d64318e1b7323fe226d08fa`.
