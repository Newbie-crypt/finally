<#
.SYNOPSIS
    FinAlly - stop script (Windows PowerShell).

.DESCRIPTION
    Stops and removes the FinAlly container.

    Your data is safe: the SQLite database lives in ./db on the host (bind-
    mounted into the container), so it is never touched by this script.
    Idempotent: running it when nothing is up is a no-op, not an error.

.EXAMPLE
    .\scripts\stop_windows.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$ContainerName = 'finally'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error 'Docker is not installed or not on your PATH.'
    exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker daemon isn't running - nothing to stop."
    exit 0
}

$Existing = docker ps --all --quiet --filter "name=^/$ContainerName$"
if (-not $Existing) {
    Write-Host "FinAlly isn't running - nothing to stop."
    exit 0
}

Write-Host 'Stopping FinAlly ...'
docker stop $ContainerName *> $null
docker rm $ContainerName *> $null

Write-Host 'FinAlly stopped. Your portfolio data is preserved in ./db'
