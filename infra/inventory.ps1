# Remote collection is read-only and requires an explicit SSH target.
param(
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,200}$')][string]$SshTarget,
  [string]$Operator,
  [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{
  recorded_at = (Get-Date).ToUniversalTime().ToString('o')
  project = '3a4d3421-7d76-421c-afe2-e981e12ef64b'
  domain = 'dim.fbr.news'
  supabase_url = 'https://supabase-control-tower-api.fbr.news'
  easypanel_project = 'sistemas'
  easypanel_service = 'dim'
  target = 'vps2'
  schema = 'custom_dim'
  source_conflict = 'dev-doc uses /09-codigo; PRD specifies monorepo root. Validate before deploy.'
  unresolved = @('VPS access/versions/resources','Easypanel networks/TLS','n8n URL','Vault credentials','Storage bucket','Remote encrypted backup','SMTP')
  evidence = 'prd/dim-dev-doc.md'
  production_modified = $false
  remote_verified = $false
}
if ($SshTarget) {
  if (-not $Operator) { throw 'Identifique o operador responsável pelo inventário.' }
  $collector = @'
set -eu
printf 'SYSTEM\n'
uname -srmo
printf 'DISK\n'
df -Pk
printf 'MEMORY\n'
free -m
printf 'DOCKER_VERSION\n'
docker version --format '{{.Server.Version}}'
printf 'SERVICES\n'
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
printf 'NETWORKS\n'
docker network ls --format '{{.Name}}\t{{.Driver}}\t{{.Scope}}'
printf 'VOLUMES\n'
docker volume ls --format '{{.Name}}\t{{.Driver}}'
'@
  $observations = $collector | & ssh -o BatchMode=yes -o ConnectTimeout=15 -- $SshTarget sh -s
  if ($LASTEXITCODE -ne 0) { throw 'Inventário remoto não foi concluído; nenhuma confirmação será registrada.' }
  $result.remote_verified = $true
  $result.remote_target = $SshTarget
  $result.observations = @($observations)
  $result.operator_attestation = $Operator
  $result.attestation_scope = 'Coleta somente leitura; exige revisão humana de redes/TLS/backup e divergências.'
}
if ($ReportPath) {
  if (Test-Path -LiteralPath $ReportPath) { throw 'Use um arquivo novo para preservar inventários anteriores.' }
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReportPath -Encoding utf8
  (Get-FileHash -LiteralPath $ReportPath -Algorithm SHA256).Hash | Set-Content -LiteralPath "$ReportPath.sha256" -Encoding ascii
}
$result | ConvertTo-Json -Depth 6
