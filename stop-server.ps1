# stop-server.ps1 - stop ONLY the Endfield gacha simulator.
# A process is considered the simulator ONLY if it is node.exe AND its command
# line runs server.js. Anything else listening on port 3276 is reported and
# left untouched (never killed blindly by port).
$ErrorActionPreference = 'SilentlyContinue'
$port = 3276
$targets = @()

$conns = Get-NetTCPConnection -LocalPort $port -State Listen
if ($conns) {
  $targets = $conns | ForEach-Object { $_.OwningProcess } | Select-Object -Unique
} else {
  # Fallback (older systems): parse netstat, local-address column only.
  $lines = netstat -aon | Select-String 'LISTENING' | Select-String ":$port\s"
  foreach ($l in $lines) {
    $cols = ($l.Line.Trim() -split '\s+')
    if ($cols[1] -match ":$port$") { $targets += [int]$cols[-1] }
  }
  $targets = $targets | Select-Object -Unique
}

if (-not $targets) { Write-Host "[OK] No simulator server found (port $port)."; exit 0 }

$killed = 0
foreach ($procId in $targets) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
  if ($proc -and ($proc.Name -like 'node*') -and ($proc.CommandLine -match 'server\.js')) {
    Stop-Process -Id $procId -Force
    Write-Host "[OK] Stopped simulator server (PID $procId)."
    $killed++
  } else {
    $nm = if ($proc) { $proc.Name } else { 'PID ' + $procId }
    Write-Host "[SKIP] Port ${port} is held by '$nm' - not the simulator, left untouched."
  }
}
if ($killed -eq 0) { Write-Host '[OK] Nothing stopped: the simulator is not running on this port.' }
