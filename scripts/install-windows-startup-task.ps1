[CmdletBinding()]
param(
	[string]$TaskName = 'VCMS',
	[string]$ProjectRoot = '',
	[string]$NodePath = ''
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) {
	$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$RunnerPath = Join-Path $ProjectRoot 'scripts\run-vcms-service.ps1'
$BuildEntry = Join-Path $ProjectRoot 'build\index.js'

if (-not (Test-Path $BuildEntry)) {
	throw "Production build not found at $BuildEntry. Run `npm.cmd run build` first."
}

if (-not $NodePath) {
	$NodePath = (Get-Command node.exe -ErrorAction Stop).Source
}

$ActionArguments = @(
	'-NoProfile',
	'-ExecutionPolicy',
	'Bypass',
	'-File',
	"`"$RunnerPath`"",
	'-ProjectRoot',
	"`"$ProjectRoot`"",
	'-NodePath',
	"`"$NodePath`""
) -join ' '

$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $ActionArguments
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
	-Description "Starts the VCMS SvelteKit Node server from $ProjectRoot at Windows startup." `
	-Force | Out-Null

Write-Host "Registered startup task '$TaskName'."
Write-Host "Node: $NodePath"
Write-Host "Logs: $(Join-Path $ProjectRoot 'logs\vcms-service.log')"
Write-Host "Start now with: Start-ScheduledTask -TaskName '$TaskName'"
