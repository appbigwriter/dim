# Read-only inventory of the local checkout; it does not connect to the VPS.
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
}
$result | ConvertTo-Json -Depth 4
