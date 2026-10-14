$ErrorActionPreference = 'Stop'

$version = '0.6.0'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$base = Join-Path $root ".tools\photocraft-$version"
$desktopZip = "photocraft-$version-windows-x64-portable.zip"
$webZip = "photocraft-web-$version.zip"
$expected = @{
  $desktopZip = '26b8f77af98de72726d90f0b28a0a8ca10ced8e49914454ddeacd12143836ab3'
  $webZip = 'c26d2e5fa8efb11c0f29ccc946c8ebd4537e07850470c4130eba3d3be0140701'
}

New-Item -ItemType Directory -Force -Path $base | Out-Null
foreach ($name in @($desktopZip, $webZip)) {
  $archive = Join-Path $base $name
  if (-not (Test-Path -LiteralPath $archive)) {
    $url = "https://github.com/storytold/photocraft/releases/download/v$version/$name"
    Invoke-WebRequest -Uri $url -OutFile $archive
  }
  $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected[$name]) { throw "SHA-256 mismatch: $name" }
}

$desktop = Join-Path $base 'desktop'
$web = Join-Path $base 'web'
Expand-Archive -LiteralPath (Join-Path $base $desktopZip) -DestinationPath $desktop -Force
Expand-Archive -LiteralPath (Join-Path $base $webZip) -DestinationPath $web -Force
$webSource = Join-Path $web "photocraft-web-$version"
$webTarget = Join-Path $root 'apps\web\public\vendor\photocraft'
New-Item -ItemType Directory -Force -Path $webTarget | Out-Null
Copy-Item -Path (Join-Path $webSource '*') -Destination $webTarget -Recurse -Force

# Keep the upstream WASM bundle intact. Add only a versioned host adapter.
$index = Join-Path $webTarget 'index.html'
$html = Get-Content -LiteralPath $index -Raw
$marker = '<script src="./acs-host-adapter.js" defer></script>'
if (-not $html.Contains($marker)) {
  $html = $html.Replace('</head>', "$marker`n</head>")
  [System.IO.File]::WriteAllText($index, $html, [System.Text.UTF8Encoding]::new($false))
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'web-host-adapter.js') -Destination (Join-Path $webTarget 'acs-host-adapter.js') -Force
Write-Output "PhotoCraft $version installed and verified."
