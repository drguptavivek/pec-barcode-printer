[CmdletBinding()]
param(
	[string]$TaskName = 'VCMS PM2',
	[string]$ProjectRoot = '',
	[string]$NodePath = ''
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) {
	$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$ProjectRoot = (Resolve-Path $ProjectRoot).Path

if (-not $NodePath) {
	$NodePath = (Get-Command node.exe -ErrorAction Stop).Source
}

$Pm2Bin = Join-Path $ProjectRoot 'node_modules\pm2\bin\pm2'
$BuildEntry = Join-Path $ProjectRoot 'build\index.js'
$Pm2Home = Join-Path $ProjectRoot '.pm2-vcms'

if (-not (Test-Path $Pm2Bin)) {
	throw "Local PM2 not found at $Pm2Bin. Run `npm.cmd install` first."
}

if (-not (Test-Path $BuildEntry)) {
	throw "Production build not found at $BuildEntry. Run `npm.cmd run build` first."
}

New-Item -ItemType Directory -Force -Path $Pm2Home | Out-Null

$ActionArguments = @(
	'/d',
	'/s',
	'/c',
	"`"cd /d `"$ProjectRoot`" && set PM2_HOME=$Pm2Home&& `"$NodePath`" `"$Pm2Bin`" resurrect`""
) -join ' '

$Action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $ActionArguments
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet `
	-AllowStartIfOnBatteries `
	-ExecutionTimeLimit (New-TimeSpan -Days 30) `
	-MultipleInstances IgnoreNew `
	-RestartCount 10 `
	-RestartInterval (New-TimeSpan -Minutes 1) `
	-StartWhenAvailable

Register-ScheduledTask `
	-TaskName $TaskName `
	-Action $Action `
	-Trigger $Trigger `
	-Principal $Principal `
	-Settings $Settings `
	-Description "Restores the VCMS PM2 process list from $ProjectRoot at Windows startup." `
	-Force | Out-Null

Write-Host "Registered startup task '$TaskName'."
Write-Host "PM2_HOME: $Pm2Home"
Write-Host "Start now with: Start-ScheduledTask -TaskName '$TaskName'"
