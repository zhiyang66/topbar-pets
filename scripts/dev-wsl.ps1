param(
    [switch]$PrefsOnly,
    [switch]$NoBrowser,
    [string]$Resolution = "1440x810",
    [int]$Port = 6080,
    [string]$Distro = "Ubuntu-24.04",
    [string]$User = "petdev"
)

$ErrorActionPreference = "Stop"
$RepoWin = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WslRepo = (wsl -d $Distro -- wslpath -a ($RepoWin -replace '\\', '/')).Trim()

if ($PrefsOnly) {
    wsl -d $Distro -u $User -- bash "$WslRepo/scripts/dev-wsl.sh" --prefs
    return
}

$Url = "http://127.0.0.1:$Port/vnc.html?autoconnect=true&resize=scale"
if (-not $NoBrowser) {
    Start-Job -ScriptBlock {
        param($TargetUrl)
        Start-Sleep -Seconds 2
        $edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
        $chrome = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
        if (Test-Path $chrome) {
            Start-Process $chrome -ArgumentList "--app=$TargetUrl"
        } elseif (Test-Path $edge) {
            Start-Process $edge -ArgumentList "--app=$TargetUrl"
        } else {
            Start-Process $TargetUrl
        }
    } -ArgumentList $Url | Out-Null
}

wsl -d $Distro -u $User -- env PREVIEW_RES=$Resolution NOVNC_PORT=$Port bash "$WslRepo/scripts/dev-wsl.sh"
