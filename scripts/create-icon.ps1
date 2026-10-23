Add-Type -AssemblyName System.Drawing
$taskBitmap = New-Object System.Drawing.Bitmap 256,256
$taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
$taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$taskGraphics.Clear([System.Drawing.Color]::FromArgb(8,126,116))
$taskBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$taskGraphics.FillRectangle($taskBrush,65,36,126,181)
$taskAccent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(8,126,116))
$taskGraphics.FillRectangle($taskAccent,83,90,89,9)
$taskGraphics.FillRectangle($taskAccent,83,115,72,9)
$taskGraphics.FillRectangle($taskAccent,83,140,89,9)
$taskGraphics.FillRectangle($taskAccent,83,165,60,9)
$taskGraphics.FillPolygon($taskAccent,[System.Drawing.Point[]]@((New-Object System.Drawing.Point 159,36),(New-Object System.Drawing.Point 191,36),(New-Object System.Drawing.Point 191,68)))
$taskStream = New-Object System.IO.MemoryStream
$taskBitmap.Save($taskStream,[System.Drawing.Imaging.ImageFormat]::Png)
$taskPng = $taskStream.ToArray()
$taskOutput = [System.IO.File]::Create((Join-Path $PSScriptRoot '..\build\icon.ico'))
$taskWriter = New-Object System.IO.BinaryWriter $taskOutput
$taskWriter.Write([UInt16]0); $taskWriter.Write([UInt16]1); $taskWriter.Write([UInt16]1)
$taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0)
$taskWriter.Write([UInt16]1); $taskWriter.Write([UInt16]32); $taskWriter.Write([UInt32]$taskPng.Length); $taskWriter.Write([UInt32]22); $taskWriter.Write($taskPng)
$taskWriter.Dispose(); $taskOutput.Dispose(); $taskStream.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose(); $taskBrush.Dispose(); $taskAccent.Dispose()
