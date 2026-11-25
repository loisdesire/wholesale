<#
.SYNOPSIS  Restore a backup from app/backups into a database.
.USAGE     powershell -ExecutionPolicy Bypass -File scripts\restore-db.ps1 -File backups\wholesale-20261125-020000.dump -Into wholesale_restore_check
           Add -Replace to overwrite an EXISTING database of that name (it is dropped first).
.NOTES     Safe by default: restores into a NEW database, and refuses if it already exists.
           To restore over your real "wholesale" database, stop the app first and pass -Replace.
#>
param(
  [Parameter(Mandatory = $true)][string]$File,
  [Parameter(Mandatory = $true)][string]$Into,
  [switch]$Replace
)

$ErrorActionPreference = "Stop"
$appDir = Split-Path -Parent $PSScriptRoot
Set-Location $appDir
if (-not (Test-Path $File)) { Write-Error "No such backup file: $File"; exit 1 }
if ($Into -notmatch '^[A-Za-z0-9_]+$') { Write-Error "Database name may only contain letters, digits and underscores."; exit 1 }

$exists = (docker compose exec -T db psql -U wholesale -d postgres -Atc "select 1 from pg_database where datname='$Into'") -eq "1"
if ($exists -and -not $Replace) { Write-Error "Database '$Into' already exists. Choose a new name, or pass -Replace to overwrite it."; exit 1 }
if ($exists) {
  docker compose exec -T db psql -U wholesale -d postgres -c "drop database `"$Into`" with (force)" | Out-Null
}
docker compose exec -T db psql -U wholesale -d postgres -c "create database `"$Into`"" | Out-Null

docker compose cp $File db:/tmp/restore.dump | Out-Null
# --no-owner: the dump's role names may not exist on a fresh machine.
docker compose exec -T db pg_restore -U wholesale -d $Into --no-owner /tmp/restore.dump
docker compose exec -T db rm -f /tmp/restore.dump | Out-Null

$tables = docker compose exec -T db psql -U wholesale -d $Into -Atc "select count(*) from information_schema.tables where table_schema='public'"
Write-Output "Restored into '$Into' ($tables tables)."
