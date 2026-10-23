$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$metadata = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
$releaseRoot = (Resolve-Path -LiteralPath 'release').Path
$folderName = "PDFReaderCO-$($metadata.version)-Carpeta"
$folder = (Resolve-Path -LiteralPath (Join-Path $releaseRoot $folderName)).Path
$archivePath = Join-Path $releaseRoot "$folderName.zip"
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
$count = 0
$seen = @{}
try {
  foreach ($entry in $archive.Entries) {
    if (!$entry.Name) { continue }
    $relative = $entry.FullName.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $target = [IO.Path]::GetFullPath((Join-Path $folder $relative))
    if (!$target.StartsWith($folder + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $seen.ContainsKey($target)) { throw 'Entrada ZIP fuera de destino o duplicada.' }
    $seen[$target] = $true
    $stream = $entry.Open()
    try { $zipHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() } finally { $stream.Dispose() }
    $diskHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($zipHash -ne $diskHash) { throw "Contenido ZIP distinto: $relative" }
    $count++
  }
} finally { $archive.Dispose() }
if ($count -ne @(Get-ChildItem -LiteralPath $folder -Recurse -File).Count) { throw 'Faltan archivos en el ZIP.' }
$sourceHash = (Get-FileHash -LiteralPath 'node_modules/electron/dist/electron.exe' -Algorithm SHA256).Hash
if ((Get-FileHash -LiteralPath (Join-Path $folder 'electron.exe') -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Runtime modificado.' }
$sums = @(Get-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') | Where-Object { $_ -notmatch [regex]::Escape($folderName) })
foreach ($file in @("$folderName.zip", "$folderName\electron.exe", "$folderName\resources\app.asar")) {
  $hash = (Get-FileHash -LiteralPath (Join-Path $releaseRoot $file) -Algorithm SHA256).Hash.ToLowerInvariant()
  $sums += "$hash  $file"
}
Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') -Value $sums -Encoding utf8
Write-Output "ZIP verificado: $count archivos idénticos; runtime Electron intacto."
