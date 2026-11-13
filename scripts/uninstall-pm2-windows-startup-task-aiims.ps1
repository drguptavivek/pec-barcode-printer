[CmdletBinding()]
param([string]$TaskName = 'VCMS PM2 AIIMS')

$ErrorActionPreference = 'Stop'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
	Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
	Write-Host "Unregistered startup task '$TaskName'."
} else {
	Write-Host "Startup task '$TaskName' was not registered."
}
