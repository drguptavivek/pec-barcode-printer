param(
	[ValidateSet('start', 'restart', 'stop', 'status', 'build', 'logs')]
	[string]$Action = 'start',
	[int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$LocalPm2Home = Join-Path $env:LOCALAPPDATA 'vcms-pm2'
$Pm2Cmd = Join-Path $ProjectRoot 'node_modules\.bin\pm2.cmd'

function Invoke-InProject {
	param([scriptblock]$Command)
	Push-Location $ProjectRoot
	try {
		& $Command
	} finally {
		Pop-Location
	}
}

function Assert-Pm2 {
	if (-not (Test-Path $Pm2Cmd)) {
		throw "PM2 was not found at $Pm2Cmd. Run 'npm.cmd install' from $ProjectRoot first."
	}
}

function Initialize-Pm2Home {
	New-Item -ItemType Directory -Force -Path $LocalPm2Home | Out-Null
	foreach ($name in @('logs', 'pids', 'modules')) {
		New-Item -ItemType Directory -Force -Path (Join-Path $LocalPm2Home $name) | Out-Null
	}
	$moduleConfig = Join-Path $LocalPm2Home 'module_conf.json'
	if (-not (Test-Path $moduleConfig)) {
		Set-Content -Path $moduleConfig -Value '{}' -Encoding ASCII
	}
	$pm2Log = Join-Path $LocalPm2Home 'pm2.log'
	if (-not (Test-Path $pm2Log)) {
		Set-Content -Path $pm2Log -Value '' -Encoding ASCII
	}
}

function Get-PortOwner {
	$connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
		Select-Object -First 1
	if (-not $connection) {
		return $null
	}

	$process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
	[pscustomobject]@{
		Pid = $connection.OwningProcess
		CommandLine = $process.CommandLine
	}
}

function Assert-PortAvailableOrLocalPm2 {
	$owner = Get-PortOwner
	if (-not $owner) {
		return
	}

	if ($owner.CommandLine -like "*$LocalPm2Home*" -or $owner.CommandLine -like '*scripts/start-production.mjs*') {
		return
	}

	throw @"
Port $Port is already in use by PID $($owner.Pid).
Command line:
$($owner.CommandLine)

This script is non-admin and will not kill protected or unrelated processes.
Stop the old SYSTEM PM2 task once from an Administrator shell, then run this script again:
  schtasks /Change /TN "VCMS PM2" /DISABLE
  schtasks /End /TN "VCMS PM2"
  netstat -ano | findstr :$Port
  taskkill /PID <PID_FROM_NETSTAT> /F
"@
}

function Build-App {
	Invoke-InProject {
		npm.cmd run build
	}
}

function Start-App {
	Assert-Pm2
	Assert-PortAvailableOrLocalPm2
	Initialize-Pm2Home
	$env:PM2_HOME = $LocalPm2Home
	$env:PORT = [string]$Port
	Invoke-InProject {
		& $Pm2Cmd start ecosystem.config.cjs --update-env
		& $Pm2Cmd save
		& $Pm2Cmd status
	}
	Write-Host "VCMS is starting on http://localhost:$Port"
}

function Stop-App {
	Assert-Pm2
	Initialize-Pm2Home
	$env:PM2_HOME = $LocalPm2Home
	Invoke-InProject {
		& $Pm2Cmd stop vcms 2>$null
		& $Pm2Cmd delete vcms 2>$null
		& $Pm2Cmd save
	}
}

function Show-Status {
	Assert-Pm2
	Initialize-Pm2Home
	$env:PM2_HOME = $LocalPm2Home
	Invoke-InProject {
		& $Pm2Cmd status
	}
	$owner = Get-PortOwner
	if ($owner) {
		Write-Host "Port $Port is listening on PID $($owner.Pid)"
	} else {
		Write-Host "Port $Port is not listening."
	}
}

function Show-Logs {
	Assert-Pm2
	Initialize-Pm2Home
	$env:PM2_HOME = $LocalPm2Home
	Invoke-InProject {
		& $Pm2Cmd logs vcms
	}
}

switch ($Action) {
	'build' {
		Build-App
	}
	'start' {
		Build-App
		Start-App
	}
	'restart' {
		Build-App
		Stop-App
		Start-App
	}
	'stop' {
		Stop-App
	}
	'status' {
		Show-Status
	}
	'logs' {
		Show-Logs
	}
}
