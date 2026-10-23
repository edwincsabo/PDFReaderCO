$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$metadata = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
$version = [string]$metadata.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Versión no válida para una publicación estable.' }
$releaseRoot = (Resolve-Path -LiteralPath 'release').Path
$folder = (Resolve-Path -LiteralPath "release/PDFReaderCO-$version-Carpeta").Path
if (!$folder.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'La distribución debe estar dentro de release.' }
$assetRoot = Join-Path $releaseRoot 'github-assets'
New-Item -ItemType Directory -Path $assetRoot -Force | Out-Null
$archivePath = Join-Path $assetRoot 'PDFReaderCO-Windows-x64.zip'
if (Test-Path -LiteralPath $archivePath) { throw 'El ZIP de publicación ya existe. Consérvalo o elige una carpeta de trabajo nueva.' }

foreach ($name in @('LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md')) {
  Copy-Item -LiteralPath $name -Destination (Join-Path $folder $name)
}
Copy-Item -LiteralPath 'licenses' -Destination (Join-Path $folder 'licenses') -Recurse
$instructions = @"
PDFReaderCO $version - Windows x64

ESPAÑOL
1. Extrae TODO el ZIP en una carpeta de tu equipo.
2. Abre Abrir PDFReaderCO.cmd con doble clic. También puedes abrir electron.exe.
3. Conserva los demás archivos junto al ejecutable.
No necesitas instalar Node.js ni escribir comandos.
Idioma: Configuración > Idioma de la interfaz > Español / English.
Uso gratuito para fines no comerciales. Consulta LICENSE y NOTICE.

ENGLISH
1. Extract the ENTIRE ZIP to a folder on your computer.
2. Double-click Abrir PDFReaderCO.cmd. You can also open electron.exe.
3. Keep the accompanying files next to the executable.
No Node.js installation or command-line instructions are required.
Language: Settings > Interface language > Español / English.
Free for noncommercial use. Read LICENSE and NOTICE.

The application uses Windows user-profile storage for settings and recovery.
La aplicación guarda configuración y recuperación en el perfil de Windows.
No project-owned Authenticode signature. Execution follows Windows policies.
Sin firma Authenticode propia. La ejecución respeta las políticas de Windows.
PDF tools and OCR run locally. Optional AI uses your API key and provider.
Las herramientas PDF y el OCR son locales. La IA opcional usa tu API key.

https://github.com/edwincsabo/PDFReaderCO
"@
Set-Content -LiteralPath (Join-Path $folder 'LEEME.txt') -Value $instructions -Encoding utf8
[IO.Compression.ZipFile]::CreateFromDirectory($folder, $archivePath, [IO.Compression.CompressionLevel]::Optimal, $false)

$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
$count = 0
$seen = @{}
try {
  foreach ($entry in $archive.Entries) {
    if (!$entry.Name) { continue }
    $relative = $entry.FullName.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $target = [IO.Path]::GetFullPath((Join-Path $folder $relative))
    if (!$target.StartsWith($folder + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $seen.ContainsKey($target)) { throw 'Ruta ZIP no válida o duplicada.' }
    $seen[$target] = $true
    $stream = $entry.Open()
    try { $zipHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() } finally { $stream.Dispose() }
    if ($zipHash -ne (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()) { throw "Contenido ZIP distinto: $relative" }
    $count++
  }
} finally { $archive.Dispose() }
if ($count -ne @(Get-ChildItem -LiteralPath $folder -Recurse -File).Count) { throw 'Faltan archivos en el ZIP.' }
if ((Get-FileHash -LiteralPath (Join-Path $folder 'electron.exe')).Hash -ne (Get-FileHash -LiteralPath 'node_modules/electron/dist/electron.exe').Hash) { throw 'El runtime de Electron fue modificado.' }

$zipSha = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $assetRoot 'SHA256SUMS.txt') -Value "$zipSha  PDFReaderCO-Windows-x64.zip" -Encoding ascii
Set-Content -LiteralPath (Join-Path $assetRoot 'version.txt') -Value $version -Encoding ascii
$notes = @"
## Español

**Descarga PDFReaderCO-Windows-x64.zip** en los archivos de esta publicación.
Extrae todo y abre **Abrir PDFReaderCO.cmd** o **electron.exe** con doble clic.
No necesitas instalar Node.js ni usar comandos. Conserva todos los archivos juntos.

Windows x64. Interfaz en español e inglés. Edición de texto compatible, OCR local
en seis idiomas, formularios, anotaciones, organización, comparación y lotes.
Asistente IA opcional con tu API key de OpenRouter, OpenAI o Claude.
Gratis para uso no comercial bajo PolyForm Noncommercial 1.0.0.
La configuración y la recuperación se guardan en el perfil de Windows.
Sin firma Authenticode propia; la ejecución depende de las políticas del equipo.

## English

**Download PDFReaderCO-Windows-x64.zip** from this release's assets.
Extract everything and double-click **Abrir PDFReaderCO.cmd** or **electron.exe**.
No Node.js installation or command-line steps are needed. Keep all files together.

Windows x64. Spanish/English interface. Compatible text editing, local OCR in six
languages, forms, annotations, organization, comparison and batch processing.
Optional AI with your OpenRouter, OpenAI or Claude API key.
Free for noncommercial use under PolyForm Noncommercial 1.0.0.
Settings and recovery use the Windows user profile.
No project-owned Authenticode signature; execution follows machine policies.

SHA-256: $zipSha

The **Source code** ZIP/tar.gz files below are for developers, not the Windows app.
Los archivos **Source code** ZIP/tar.gz son para desarrolladores, no la app de Windows.
"@
Set-Content -LiteralPath (Join-Path $assetRoot 'RELEASE-NOTES.md') -Value $notes -Encoding utf8
Write-Output "ZIP preparado y verificado: $count archivos; SHA-256 $zipSha"
