<#
.SYNOPSIS
    FinAlly - start script (Windows PowerShell).

.DESCRIPTION
    Builds the Docker image if it doesn't exist yet, runs the container with the
    ./db bind mount, the port mapping and your .env file, then waits for the app
    to report healthy.

    Idempotent: safe to run repeatedly. If the container is already running it
    just tells you where it is; a stale/exited container is replaced.

.PARAMETER Build
    Force a rebuild of the image even if one already exists.

.PARAMETER Open
    Open the app in your default browser once it is up.

.EXAMPLE
    .\scripts\start_windows.ps1
.EXAMPLE
    .\scripts\start_windows.ps1 -Build -Open
#>
[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$Open
)

$ErrorActionPreference = 'Stop'

$ImageName     = 'finally:latest'
$ContainerName = 'finally'
$Port          = 8000
$Url           = "http://localhost:$Port"

# Resolve the project root from this script's location, so it works from any
# working directory.
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

# --- Preflight -------------------------------------------------------------

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error 'Docker is not installed or not on your PATH. Install Docker Desktop: https://www.docker.com/products/docker-desktop'
    exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Error "The Docker daemon isn't running. Start Docker Desktop and retry."
    exit 1
}

if (-not (Test-Path '.env')) {
    if (Test-Path '.env.example') {
        Write-Host 'No .env found - creating one from .env.example.'
        Copy-Item '.env.example' '.env'
        Write-Host '  -> Edit .env and add your OPENROUTER_API_KEY for AI chat to work.'
    }
    else {
        Write-Error "Neither .env nor .env.example exists in $ProjectRoot."
        exit 1
    }
}

# The SQLite database lives here on the host, bind-mounted to /app/db.
if (-not (Test-Path 'db')) {
    New-Item -ItemType Directory -Path 'db' | Out-Null
}

# --- Build -----------------------------------------------------------------

docker image inspect $ImageName *> $null
$ImageExists = ($LASTEXITCODE -eq 0)

if ($Build -or -not $ImageExists) {
    Write-Host "Building $ImageName ..."
    docker build -t $ImageName .
    if ($LASTEXITCODE -ne 0) {
        Write-Error 'Docker build failed.'
        exit 1
    }
}
else {
    Write-Host "Image $ImageName already built (use -Build to rebuild)."
}

# --- Run -------------------------------------------------------------------

$Running = docker ps --quiet --filter "name=^/$ContainerName$"
if ($Running) {
    Write-Host "FinAlly is already running at $Url"
}
else {
    # Remove a stopped container of the same name so `docker run` won't collide.
    $Existing = docker ps --all --quiet --filter "name=^/$ContainerName$"
    if ($Existing) {
        Write-Host 'Removing previous (stopped) container ...'
        docker rm --force $ContainerName *> $null
    }

    Write-Host 'Starting FinAlly ...'
    docker run --detach `
        --name $ContainerName `
        --publish "${Port}:8000" `
        --volume "${ProjectRoot}\db:/app/db" `
        --env-file .env `
        --restart unless-stopped `
        $ImageName *> $null

    if ($LASTEXITCODE -ne 0) {
        Write-Error 'Failed to start the FinAlly container.'
        exit 1
    }
}

# --- Wait for health -------------------------------------------------------

Write-Host -NoNewline 'Waiting for FinAlly to come up '
foreach ($attempt in 1..40) {
    try {
        $response = Invoke-WebRequest -Uri "$Url/api/health" -TimeoutSec 2 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            Write-Host ''
            Write-Host "FinAlly is live: $Url"
            if ($Open) { Start-Process $Url }
            exit 0
        }
    }
    catch {
        # Not up yet - keep polling.
    }
    Write-Host -NoNewline '.'
    Start-Sleep -Seconds 1
}

Write-Host ''
Write-Warning "FinAlly didn't report healthy within 40s. Recent logs:"
docker logs --tail 40 $ContainerName
Write-Warning "The container may still be starting - check $Url or run: docker logs -f $ContainerName"
exit 1
