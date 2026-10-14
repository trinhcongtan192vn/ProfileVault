param(
  [Parameter(Mandatory = $true)][uri]$Uri,
  [ValidateSet('GET', 'POST')][string]$Method = 'GET',
  [string]$BodyFile
)
$ErrorActionPreference = 'Stop'
if ($Uri.Scheme -ne 'http' -or $Uri.Host -notin @('127.0.0.1', 'localhost')) { throw 'Chỉ gọi Fury loopback đã xác minh' }
$headers = @{}
if ($env:PV_SPIKE_FURY_TOKEN) { $headers.Authorization = "Bearer $env:PV_SPIKE_FURY_TOKEN" }
$argsForRequest = @{ Uri = $Uri; Method = $Method; Headers = $headers; TimeoutSec = 60 }
if ($BodyFile) { $argsForRequest.Body = Get-Content -LiteralPath $BodyFile -Raw; $argsForRequest.ContentType = 'application/json' }
$result = Invoke-RestMethod @argsForRequest
# Chỉ xuất hình dạng dữ liệu, không giá trị có thể chứa token/cookie/credential.
function Get-Shape($value) {
  if ($null -eq $value) { return 'null' }
  if ($value -is [string]) { return 'string' }
  if ($value -is [bool]) { return 'boolean' }
  if ($value -is [ValueType]) { return 'number' }
  if ($value -is [array]) { return ,@($value | Select-Object -First 1 | ForEach-Object { Get-Shape $_ }) }
  $shape = [ordered]@{}
  foreach ($property in $value.PSObject.Properties) { $shape[$property.Name] = Get-Shape $property.Value }
  return $shape
}
Get-Shape $result | ConvertTo-Json -Depth 20
