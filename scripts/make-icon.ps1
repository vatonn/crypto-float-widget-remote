Add-Type -AssemblyName System.Drawing

$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$outer = New-RoundedPath 0 0 512 512 108
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(0, 0)),
  (New-Object System.Drawing.Point(0, 512)),
  [System.Drawing.Color]::FromArgb(255, 32, 32, 40),
  [System.Drawing.Color]::FromArgb(255, 13, 13, 17))
$g.FillPath($bg, $outer)

$edge = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(38, 255, 255, 255)), 3
$g.DrawPath($edge, $outer)

$baseline = 388
$bars = @(
  @{ x = 107; h = 118; a = 90 },
  @{ x = 189; h = 194; a = 135 },
  @{ x = 271; h = 152; a = 185 },
  @{ x = 353; h = 262; a = 255 }
)

foreach ($b in $bars) {
  $bp = New-RoundedPath $b.x ($baseline - $b.h) 52 $b.h 14
  $color = [System.Drawing.Color]::FromArgb([int]$b.a, 53, 208, 127)
  $brush = New-Object System.Drawing.SolidBrush $color
  $g.FillPath($brush, $bp)
  $brush.Dispose()
  $bp.Dispose()
}

$target = Join-Path $PSScriptRoot '..\build'
New-Item -ItemType Directory -Force -Path $target | Out-Null
$bmp.Save((Join-Path $target 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Get-Item (Join-Path $target 'icon.png') | Select-Object FullName, Length
