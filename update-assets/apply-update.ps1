$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$committed = New-Object System.Collections.ArrayList
$pending = New-Object System.Collections.ArrayList
try {
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'update-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.product -ne 'PersonalArchive' -or $manifest.to -ne '0.3.0') { throw 'Invalid update manifest.' }
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = 'Select the existing folder containing PersonalArchive.exe (version 0.2.0, 0.2.1, 0.2.2 or 0.2.3).'
    $picker.ShowNewFolderButton = $false
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'PersonalArchive.exe')) { $picker.SelectedPath = $PSScriptRoot }
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
    $install = [System.IO.Path]::GetFullPath($picker.SelectedPath).TrimEnd('\')
    $exe = Join-Path $install 'PersonalArchive.exe'
    $bundle = Join-Path $install 'resources\app.asar'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -or -not (Test-Path -LiteralPath $bundle -PathType Leaf)) { throw 'Select the original application folder, not the update folder.' }
    if (Get-Process -Name PersonalArchive -ErrorAction SilentlyContinue) { throw 'Close Personal Archive completely, then run this updater again. No process was terminated.' }
    $bundleEntry = @($manifest.files | Where-Object { $_.path -eq 'resources/app.asar' })
    if ($bundleEntry.Count -ne 1) { throw 'Invalid application entry.' }
    $oldHash = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash
    if ($oldHash -notin @($manifest.baseAsarSha256) -and $oldHash -ne $bundleEntry[0].sha256) { throw 'This update is for the supplied PersonalArchive 0.2.0, 0.2.1, 0.2.2 or 0.2.3 package. The selected application is a different build.' }
    $backup = Join-Path $install ('.update-backups\before-0.3.0-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
    # Verify every payload before touching installed files; only fixed resources
    # and version metadata are accepted, never data-directory contents.
    foreach ($entry in $manifest.files) {
        if ($entry.path -notin @('resources/app.asar','version.txt','resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node')) { throw 'Unexpected update destination.' }
        $source = Join-Path $PSScriptRoot $entry.path
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'Update checksum mismatch. Please extract the update again.' }
    }
    # Native dependency first, version metadata next, application pointer last.
    $ordered = @($manifest.files | Sort-Object @{Expression={if ($_.path -eq 'resources/app.asar') {2} elseif ($_.path -eq 'version.txt') {1} else {0}}})
    foreach ($entry in $ordered) {
        $source = Join-Path $PSScriptRoot $entry.path
        $target = Join-Path $install $entry.path
        $parent = Split-Path -Parent $target
        [System.IO.Directory]::CreateDirectory($parent) | Out-Null
        $temporary = Join-Path $parent ('.archive-update-' + [Guid]::NewGuid().ToString('N') + '.tmp')
        [void]$pending.Add($temporary)
        [System.IO.File]::Copy($source,$temporary,$false)
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'Staged file checksum mismatch.' }
        $existed = Test-Path -LiteralPath $target -PathType Leaf
        $saved = Join-Path $backup $entry.path
        if ($existed) {
            [System.IO.Directory]::CreateDirectory((Split-Path -Parent $saved)) | Out-Null
            [System.IO.File]::Replace($temporary,$target,$saved)
        } else {
            [System.IO.File]::Move($temporary,$target)
        }
        [void]$committed.Add([PSCustomObject]@{Target=$target;Backup=$saved;Existed=$existed})
    }
    [System.Windows.Forms.MessageBox]::Show('Updated to 0.3.0. Start PersonalArchive.exe from the original folder. Your archive was not moved or modified by this updater.','Personal Archive update') | Out-Null
    exit 0
} catch {
    $failure = $_.Exception.Message
    for ($i=$committed.Count-1; $i -ge 0; $i--) {
        $item=$committed[$i]
        try {
            if ($item.Existed -and (Test-Path -LiteralPath $item.Backup)) { [System.IO.File]::Copy($item.Backup,$item.Target,$true) }
            elseif (-not $item.Existed -and (Test-Path -LiteralPath $item.Target)) { [System.IO.File]::Delete($item.Target) }
        } catch { }
    }
    [System.Windows.Forms.MessageBox]::Show(('Update was not completed. Original files were restored where possible.' + [Environment]::NewLine + $failure),'Personal Archive update') | Out-Null
    exit 1
} finally {
    foreach ($temporary in $pending) { try { if (Test-Path -LiteralPath $temporary) { [System.IO.File]::Delete($temporary) } } catch { } }
}
