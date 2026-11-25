<#
.SYNOPSIS  Back up the local Postgres (Docker) to a dated file in app/backups, and keep the newest N.
.USAGE     powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1 [-Keep 14] [-Database wholesale]
.NOTES     Needs Docker Desktop running and the db container started (docker compose up -d).
           Exit code 0 = a verified backup exists. Anything else = no new backup was made.
#>
param([int]$Keep = 14, [string]$Database = "wholesale")

$ErrorActionPreference = "Stop"
$appDir = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $appDir "backups"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Set-Location $appDir

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file = Join-Path $outDir "$Database-$stamp.dump"
$tmp = "$file.partial"

try {
  # Custom format (-Fc): compressed, and restorable one table at a time. Dump inside the container
  # and copy the file out, so PowerShell never touches the binary stream.
  docker compose exec -T db sh -c "pg_dump -U wholesale -Fc -f /tmp/backup.dump $Database"
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (is the db container running?)" }
  docker compose cp db:/tmp/backup.dump $tmp
  if ($LASTEXITCODE -ne 0) { throw "could not copy the dump out of the container" }
  docker compose exec -T db rm -f /tmp/backup.dump | Out-Null

  # Verify before trusting it: non-trivial size, and Postgres can read its table of contents.
  if ((Get-Item $tmp).Length -lt 10KB) { throw "backup is suspiciously small" }
  docker compose cp $tmp db:/tmp/verify.dump | Out-Null
  $toc = docker compose exec -T db pg_restore --list /tmp/verify.dump
  docker compose exec -T db rm -f /tmp/verify.dump | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not ($toc -match 'TABLE DATA')) { throw "backup failed verification" }

  Move-Item -Force $tmp $file
} catch {
  Remove-Item -Force -ErrorAction SilentlyContinue $tmp
  Write-Error "Backup FAILED: $_"
  exit 1
}

# Retention: newest $Keep only.
Get-ChildItem $outDir -Filter "$Database-*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | Remove-Item -Force

$size = [math]::Round((Get-Item $file).Length / 1KB)
Write-Output "Backup OK: $file ($size KB). Keeping the newest $Keep."
