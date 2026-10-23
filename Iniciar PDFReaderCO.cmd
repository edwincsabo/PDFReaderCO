@echo off
cd /d "%~dp0"
if exist "%~dp0release\PDFReaderCO-1.49.1-Carpeta\electron.exe" (
  start "" "%~dp0release\PDFReaderCO-1.49.1-Carpeta\electron.exe" %*
) else if exist "%~dp0node_modules\electron\dist\electron.exe" (
  start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0" %*
) else (
  echo Extrae la distribucion en carpeta y abre su archivo Abrir PDFReaderCO.cmd.
  pause
)
