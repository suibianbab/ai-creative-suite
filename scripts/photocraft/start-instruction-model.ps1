$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logs = Join-Path $repo '.tools'
New-Item -ItemType Directory -Path $logs -Force | Out-Null

try {
    $health = Invoke-WebRequest -Uri 'http://127.0.0.1:11435/health' -TimeoutSec 2 -ErrorAction Stop
    if ($health.StatusCode -eq 200) {
        Write-Output 'PhotoCraft instruction model is already listening on 127.0.0.1:11435'
        exit 0
    }
} catch {
    # No local model service is listening yet.
}

$ollama = Get-Command ollama -ErrorAction Stop
$server = Join-Path (Split-Path $ollama.Source -Parent) 'lib\ollama\llama-server.exe'
if (!(Test-Path -LiteralPath $server)) {
    throw "llama-server.exe was not found beside Ollama: $server"
}

$gguf = $env:PHOTOCRAFT_INSTRUCTION_GGUF
if (!$gguf) {
    if (!$env:OLLAMA_MODELS) {
        throw 'Set PHOTOCRAFT_INSTRUCTION_GGUF or OLLAMA_MODELS to locate the local Qwen3 4B weight'
    }
    $manifest = Join-Path $env:OLLAMA_MODELS 'manifests\registry.ollama.ai\library\qwen3\4b'
    if (!(Test-Path -LiteralPath $manifest)) {
        throw "Qwen3 4B manifest not found: $manifest"
    }
    $record = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    $layer = $record.layers | Where-Object { $_.mediaType -eq 'application/vnd.ollama.image.model' } | Select-Object -First 1
    if (!$layer -or $layer.digest -notmatch '^sha256:[0-9a-f]{64}$') {
        throw 'Qwen3 4B manifest has no valid model layer'
    }
    $gguf = Join-Path $env:OLLAMA_MODELS ('blobs\sha256-' + $layer.digest.Substring(7))
}
if (!(Test-Path -LiteralPath $gguf)) {
    throw "GGUF weight not found: $gguf"
}

$process = Start-Process -FilePath $server -ArgumentList @(
    '--model', $gguf,
    '--host', '127.0.0.1',
    '--port', '11435',
    '--ctx-size', '4096',
    '--parallel', '1'
) -WorkingDirectory $repo -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'photocraft-llama.log') `
    -RedirectStandardError (Join-Path $logs 'photocraft-llama.err.log')
Write-Output "PhotoCraft instruction model started, PID $($process.Id), port 11435"
