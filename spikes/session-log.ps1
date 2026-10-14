param(
  [Parameter(Mandatory = $true)][string]$OutputFile,
  [Parameter(Mandatory = $true)][ValidateSet('open', 'close', 'restart', 'detect-gate')][string]$Action,
  [Parameter(Mandatory = $true)][ValidateSet('pass', 'fail')][string]$Result,
  [string]$FuryVersion
)
# Người vận hành ghi bằng chứng; script không tự mở Fury hay đăng nhập.
$entry = [ordered]@{ at = [DateTime]::UtcNow.ToString('o'); action = $Action; result = $Result; furyVersion = $FuryVersion }
Add-Content -LiteralPath $OutputFile -Value ($entry | ConvertTo-Json -Compress) -Encoding UTF8
