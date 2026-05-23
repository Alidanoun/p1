Write-Host "=== AZURE VM INFO ==="
try {
    $imds = Invoke-RestMethod -Headers @{"Metadata"="true"} -Method GET -Uri "http://169.254.169.254/metadata/instance?api-version=2021-02-01" -TimeoutSec 2
    Write-Host "name: $($imds.compute.name)"
    Write-Host "location: $($imds.compute.location)"
    Write-Host "vmSize: $($imds.compute.vmSize)"
} catch {
    Write-Host "Not an Azure VM or IMDS endpoint unreachable."
}

Write-Host "`n=== CPU & MEMORY DETAILS ==="
Write-Host "CPUs: $env:NUMBER_OF_PROCESSORS"
$os = Get-CimInstance Win32_OperatingSystem
$totalMem = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
$freeMem = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
Write-Host "Total Memory: $totalMem GB"
Write-Host "Free Memory: $freeMem GB"

Write-Host "`n=== TOP PROCESSES ==="
Get-Process | Sort-Object -Property WS -Descending | Select-Object Name, @{Name="Memory(MB)";Expression={[math]::Round($_.WS / 1MB, 2)}} -First 10 | Format-Table -AutoSize | Out-String | Write-Host

Write-Host "=== BACKEND LOGS (last 50) ==="
try {
    $logs = docker logs --tail 50 al-markazia-prod-app 2>&1
    if ($LASTEXITCODE -eq 0 -and $logs) {
        $logs | Out-String | Write-Host
    } else {
        Write-Host "No logs found in al-markazia-prod-app container (container might not be running)."
    }
} catch {
    Write-Host "Docker logs failed."
}

Write-Host "=== SYSTEM UPTIME & CRASHES ==="
$uptime = (Get-Date) - $os.LastBootUpTime
Write-Host "Uptime: $($uptime.Days) days, $($uptime.Hours) hours, $($uptime.Minutes) minutes"

Write-Host "`n=== NETWORK CONNECTIONS ==="
Get-NetTCPConnection -ErrorAction SilentlyContinue | Group-Object State | Select-Object Name, Count | Format-Table -AutoSize | Out-String | Write-Host
