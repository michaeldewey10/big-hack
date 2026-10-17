param(
    [switch]$SkipBridge,
    [string]$OutputDirectory,
    [string]$PythonExecutable,
    [string]$FridaPath
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist\Big-Hack' }
$portableDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$buildDirectory = Join-Path $projectRoot 'target\package\bridge'
if (!$PythonExecutable) {
    $PythonExecutable = if ($env:BIG_HACK_PYTHON) { $env:BIG_HACK_PYTHON } else { 'python' }
}
if ($FridaPath) { $env:BIG_HACK_FRIDA_PATH = (Resolve-Path -LiteralPath $FridaPath).Path }

Push-Location $projectRoot
try {
    cargo build --release --locked
    if ($LASTEXITCODE) { throw 'Rust compilation failed' }
    New-Item -ItemType Directory -Force -Path $portableDirectory | Out-Null
    if (!$SkipBridge) {
        & $PythonExecutable -m PyInstaller --noconfirm --distpath $portableDirectory --workpath $buildDirectory 'bridge\BigHackBridge.spec'
        if ($LASTEXITCODE) { throw 'Bridge packaging failed. Install requirements-build.txt in the selected Python environment.' }
    }
    if (!(Test-Path -LiteralPath (Join-Path $portableDirectory 'BigHackBridge.exe'))) {
        throw 'The portable package needs BigHackBridge.exe. Build without -SkipBridge first.'
    }
    Copy-Item -LiteralPath 'target\release\big-hack.exe' -Destination (Join-Path $portableDirectory 'BigHack.exe') -Force
    foreach ($name in @('README.md','CRASH-INVESTIGATION.md','THIRD-PARTY-NOTICES.md','LICENSE')) {
        Copy-Item -LiteralPath $name -Destination $portableDirectory -Force
    }
    $licenses = Join-Path $portableDirectory 'licenses'
    New-Item -ItemType Directory -Force -Path $licenses | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'packaging\licenses') -File |
        Copy-Item -Destination $licenses -Force
    & $PythonExecutable 'packaging\collect-licenses.py' --output $licenses
    if ($LASTEXITCODE) { throw 'Dependency notice collection failed' }
    Write-Host "Built: $portableDirectory\BigHack.exe"
} finally { Pop-Location }
