param(
  [Parameter(Mandatory = $true)][uri]$Uri,
  [Parameter(Mandatory = $true)][string]$ProtocolVersion
)
$ErrorActionPreference = 'Stop'
if ($Uri.Scheme -ne 'http' -or $Uri.Host -notin @('127.0.0.1', 'localhost')) { throw 'Chỉ kiểm MCP loopback' }
if (-not $env:PV_SPIKE_MCP_TOKEN) { throw 'Cần PV_SPIKE_MCP_TOKEN của server test' }
$body = @{ jsonrpc = '2.0'; id = 1; method = 'initialize'; params = @{ protocolVersion = $ProtocolVersion; capabilities = @{}; clientInfo = @{ name = 'pv-spike-p7'; version = '1.0.0' } } } | ConvertTo-Json -Depth 8
$baseHeaders = @{ Accept = 'application/json, text/event-stream' }
try {
  $anonymous = Invoke-WebRequest -UseBasicParsing -Uri $Uri -Method POST -Headers $baseHeaders -ContentType 'application/json' -Body $body -TimeoutSec 10
  throw 'Server không từ chối initialize thiếu token'
} catch {
  if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { Write-Output 'Không token: 401 (đạt)' }
  else { throw }
}
$headers = @{ Accept = 'application/json, text/event-stream'; Authorization = "Bearer $env:PV_SPIKE_MCP_TOKEN" }
$response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -Method POST -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 10
Write-Output "Có token: HTTP $($response.StatusCode); Content-Type $($response.Headers['Content-Type'])"
$session = $response.Headers['Mcp-Session-Id']
if ($session) { $headers['Mcp-Session-Id'] = $session }
$headers['MCP-Protocol-Version'] = $ProtocolVersion
$notification = @{ jsonrpc = '2.0'; method = 'notifications/initialized' } | ConvertTo-Json -Compress
$null = Invoke-WebRequest -UseBasicParsing -Uri $Uri -Method POST -Headers $headers -ContentType 'application/json' -Body $notification -TimeoutSec 10
$list = @{ jsonrpc = '2.0'; id = 2; method = 'tools/list'; params = @{} } | ConvertTo-Json -Compress
$listed = Invoke-WebRequest -UseBasicParsing -Uri $Uri -Method POST -Headers $headers -ContentType 'application/json' -Body $list -TimeoutSec 10
Write-Output "tools/list: HTTP $($listed.StatusCode)"
# Không in response/token/session. Kiểm Claude Code và Desktop riêng theo P7-mcp.md.
