param(
	[string]$ProjectRoot = '',
	[string]$NodePath = 'node.exe'
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) {
	$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$LogDirectory = Join-Path $ProjectRoot 'logs'
$LogFile = Join-Path $LogDirectory 'vcms-service.log'

New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
Set-Location $ProjectRoot

"[$(Get-Date -Format o)] Starting VCMS from $ProjectRoot" | Out-File -FilePath $LogFile -Append -Encoding utf8
& $NodePath (Join-Path $ProjectRoot 'scripts\start-production.mjs') *>> $LogFile
$ExitCode = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } else { 0 }
"[$(Get-Date -Format o)] VCMS exited with code $ExitCode" | Out-File -FilePath $LogFile -Append -Encoding utf8

exit $ExitCode
