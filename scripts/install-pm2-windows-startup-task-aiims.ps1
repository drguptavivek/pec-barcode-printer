[CmdletBinding()]
param(
	[string]$TaskName = 'VCMS PM2 AIIMS',
	[string]$ProjectRoot = '',
	[int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

if (-not $ProjectRoot) {
	$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$ProjectRoot = (Resolve-Path $ProjectRoot).Path

$LocalUserScript = Join-Path $ProjectRoot 'scripts\vcms-local-user.ps1'
if (-not (Test-Path $LocalUserScript)) {
	throw "Local-user PM2 script not found at $LocalUserScript."
}

$BuildEntry = Join-Path $ProjectRoot 'build\index.js'
if (-not (Test-Path $BuildEntry)) {
	Write-Host "Production build was not found. Building before registering startup task..."
	Push-Location $ProjectRoot
	try {
		npm.cmd run build
	} finally {
		Pop-Location
	}
}

$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$PowerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$ActionArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$LocalUserScript`" start -Port $Port"

$Action = New-ScheduledTaskAction -Execute $PowerShellPath -Argument $ActionArguments -WorkingDirectory $ProjectRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
	-AllowStartIfOnBatteries `
	-ExecutionTimeLimit (New-TimeSpan -Days 30) `
	-MultipleInstances IgnoreNew `
	-RestartCount 3 `
	-RestartInterval (New-TimeSpan -Minutes 1) `
	-StartWhenAvailable

Register-ScheduledTask `
	-TaskName $TaskName `
	-Action $Action `
	-Trigger $Trigger `
	-Principal $Principal `
	-Settings $Settings `
	-Description "Starts VCMS PM2 as $CurrentUser from $ProjectRoot at user logon." `
	-Force | Out-Null

Write-Host "Registered startup task '$TaskName' for $CurrentUser."
Write-Host "Start now with: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Check status with: PowerShell -ExecutionPolicy Bypass -File `"$LocalUserScript`" status -Port $Port"
