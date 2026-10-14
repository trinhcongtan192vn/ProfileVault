$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dataRoot = Join-Path $repoRoot '.pv-data\local'
$appDataDir = Join-Path $dataRoot 'appdata'
$localDataDir = Join-Path $dataRoot 'localappdata'
$form = New-Object System.Windows.Forms.Form
$form.Text = 'ProfileVault — bản thử trên máy này'
$form.Size = New-Object System.Drawing.Size(510, 180)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(24, 20)
$label.Size = New-Object System.Drawing.Size(450, 58)
$label.Text = 'Đang chuẩn bị ProfileVault…'
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(24, 90)
$bar.Size = New-Object System.Drawing.Size(450, 20)
$bar.Style = 'Marquee'
$form.Controls.Add($label)
$form.Controls.Add($bar)

function Set-Message([string]$message) {
  $label.Text = $message
  [System.Windows.Forms.Application]::DoEvents()
}
function Invoke-Prepare([string]$pnpmPath, [string]$action) {
  $stdoutFile = Join-Path $localDataDir 'prepare-output.log'
  $stderrFile = Join-Path $localDataDir 'prepare-error.log'
  $command = '/d /s /c ""' + $pnpmPath + '" ' + $action + '"'
  $process = Start-Process -FilePath $env:ComSpec -ArgumentList $command -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile -PassThru
  while (-not $process.HasExited) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100; $process.Refresh() }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "Không chuẩn bị được ứng dụng. Xem chi tiết tại $stderrFile và $stdoutFile." }
}
try {
  New-Item -ItemType Directory -Path $appDataDir, $localDataDir -Force | Out-Null
  $requestFile = Join-Path $appDataDir 'open-dashboard.request'
  $lockFile = Join-Path $appDataDir 'service.lock'
  if (Test-Path -LiteralPath $lockFile) {
    $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
    $existing = Get-Process -Id $lock.pid -ErrorAction SilentlyContinue
    if ($existing -and $existing.ProcessName -eq 'node') {
      Set-Content -LiteralPath $requestFile -Value 'open' -Encoding ASCII
      exit 0
    }
  }
  $form.Show()
  Set-Message 'Đang kiểm tra thành phần chạy bản thử…'
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if (-not $node -or -not $pnpm) { throw 'Bản thử từ mã nguồn cần Node.js 22 và pnpm 10 trên máy. Cài hai thành phần này một lần rồi bấm mở lại. Bản cài đặt phát hành sẽ đóng gói sẵn bộ chạy.' }
  $version = & $node.Source --version
  if ([int]($version.TrimStart('v').Split('.')[0]) -lt 22) { throw 'Bản thử cần Node.js 22 trở lên. Hãy cập nhật Node.js rồi bấm mở lại.' }
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules\.modules.yaml'))) {
    $answer = [System.Windows.Forms.MessageBox]::Show('Lần đầu cần tải các thư viện của bản thử. Bạn muốn chuẩn bị ngay không?', 'Chuẩn bị ProfileVault', 'YesNo', 'Question')
    if ($answer -ne 'Yes') { exit 0 }
    Set-Message 'Đang tải thành phần của bản thử. Việc này chỉ cần ở lần đầu…'
    Invoke-Prepare $pnpm.Source 'install --frozen-lockfile'
  }
  Set-Message 'Đang cập nhật bản thử từ mã nguồn hiện tại. Cửa sổ ứng dụng sẽ mở khi hoàn tất…'
  Invoke-Prepare $pnpm.Source 'build'
  $env:PV_APPDATA_DIR = $appDataDir
  $env:PV_LOCALAPPDATA_DIR = $localDataDir
  $env:PV_OPEN_DASHBOARD = '1'
  $readyFile = Join-Path $localDataDir 'ready'
  if (Test-Path -LiteralPath $readyFile) { Remove-Item -LiteralPath $readyFile }
  $main = Join-Path $repoRoot 'apps\service\dist\main.js'
  $service = Start-Process -FilePath $node.Source -ArgumentList ('"' + $main + '"') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardError (Join-Path $localDataDir 'startup-error.log') -PassThru
  Set-Message 'Đang mở ứng dụng…'
  for ($attempt = 0; $attempt -lt 100; $attempt++) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 100
    $service.Refresh()
    if ($service.HasExited) { throw ('Ứng dụng chưa khởi động được. Xem ' + (Join-Path $localDataDir 'startup-error.log')) }
    if (Test-Path -LiteralPath (Join-Path $localDataDir 'ready')) { break }
  }
} catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Chưa mở được ProfileVault', 'OK', 'Error') | Out-Null
} finally {
  $form.Close()
  $form.Dispose()
}
