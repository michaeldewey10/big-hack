param(
    [string]$PortableDirectory,
    [string]$OutputFile,
    [string]$RuntimeDll
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $projectRoot
if (!$PortableDirectory) { $PortableDirectory = Join-Path $projectRoot 'dist\Big-Hack' }
if (!$OutputFile) { $OutputFile = Join-Path $projectRoot 'dist\BigHack.exe' }
$PortableDirectory = (Resolve-Path -LiteralPath $PortableDirectory).Path
$OutputFile = [IO.Path]::GetFullPath($OutputFile)
New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($OutputFile)) | Out-Null
if ([IO.Path]::GetDirectoryName($OutputFile).TrimEnd('\') -eq $PortableDirectory.TrimEnd('\')) {
    throw 'Write the single EXE outside the portable input folder.'
}
foreach ($required in @('BigHack.exe', 'BigHackBridge.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $PortableDirectory $required))) { throw "Missing $required; build the portable package first." }
}

$localTools = Join-Path $workspaceRoot 'work\rust-tools'
if (Test-Path -LiteralPath (Join-Path $localTools 'cargo\bin\rustc.exe')) {
    $env:CARGO_HOME = Join-Path $localTools 'cargo'
    $env:RUSTUP_HOME = Join-Path $localTools 'rustup'
    $env:PATH = "$env:CARGO_HOME\bin;$env:PATH"
}
if (!$RuntimeDll) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path -LiteralPath $vswhere) {
        $vsRoot = & $vswhere -latest -products '*' -property installationPath
        if ($vsRoot) {
            $RuntimeDll = Get-ChildItem -Path (Join-Path $vsRoot 'VC\Redist\MSVC\*\x64\Microsoft.VC*.CRT\vcruntime140.dll') |
                Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
        }
    }
}
if (!$RuntimeDll -or !(Test-Path -LiteralPath $RuntimeDll)) {
    throw 'Supply -RuntimeDll with the x64 Visual C++ redistributable vcruntime140.dll.'
}
Copy-Item -LiteralPath $RuntimeDll -Destination (Join-Path $PortableDirectory 'vcruntime140.dll') -Force

$buildDirectory = Join-Path $projectRoot 'target\package\single'
New-Item -ItemType Directory -Force -Path $buildDirectory | Out-Null
$payloadPath = Join-Path $buildDirectory 'payload.bin'
$files = @(Get-ChildItem -LiteralPath $PortableDirectory -Recurse -File | Sort-Object FullName)
$stream = [IO.File]::Create($payloadPath)
$writer = [IO.BinaryWriter]::new($stream, [Text.Encoding]::UTF8)
try {
    $writer.Write([Text.Encoding]::ASCII.GetBytes('BIGHACK1'))
    $writer.Write([uint32]$files.Count)
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($PortableDirectory.TrimEnd('\').Length + 1)
        $nameBytes = [Text.Encoding]::UTF8.GetBytes($relative)
        $writer.Write([uint32]$nameBytes.Length)
        $writer.Write([uint64]$file.Length)
        $writer.Write($nameBytes)
        $writer.Flush()
        $source = [IO.File]::OpenRead($file.FullName)
        try { $source.CopyTo($stream) } finally { $source.Dispose() }
    }
} finally { $writer.Dispose() }
$env:BIG_HACK_PAYLOAD = $payloadPath
$env:BIG_HACK_BUNDLE_ID = (Get-FileHash -LiteralPath $payloadPath -Algorithm SHA256).Hash.Substring(0,16).ToLowerInvariant()

$rc = $env:RC
if (!$rc) {
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $rc = Get-ChildItem -LiteralPath $kits -Directory | Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64\rc.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (!$rc) { throw 'Install the Windows SDK or set RC to rc.exe.' }
$resource = Join-Path $buildDirectory 'launcher.res'
Push-Location $projectRoot
try {
    & $rc /nologo "/fo$resource" 'assets\icon.rc'
    if ($LASTEXITCODE) { throw 'Icon resource compilation failed.' }
    # Static CRT keeps the launcher itself independent of a VC runtime install.
    & rustc --edition=2024 -C opt-level=2 -C strip=symbols -C target-feature=+crt-static -C "link-arg=$resource" `
        (Join-Path $PSScriptRoot 'launcher.rs') -o $OutputFile
    if ($LASTEXITCODE) { throw 'Single EXE compilation failed.' }
} finally { Pop-Location }
Get-Item -LiteralPath $OutputFile | Select-Object FullName, Length
