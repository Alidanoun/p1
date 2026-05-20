# ─────────────────────────────────────────────────────────────
# Generate Secure Redis Passwords for Al Markazia Project
# ─────────────────────────────────────────────────────────────
# Usage: .\scripts\generate-redis-passwords.ps1
#
# Generates two cryptographically secure 48-character passwords
# for Redis ACL users: app_main and app_worker
# ─────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'

function Generate-SecurePassword {
    param(
        [int]$Length = 48
    )

    $bytes = [byte[]]::new([math]::Ceiling($Length * 0.75))
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $password = [Convert]::ToBase64String($bytes) -replace '[+/=]', '' -replace '\\', 'x'

    # Ensure minimum length
    while ($password.Length -lt $Length) {
        $extraBytes = [byte[]]::new(8)
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($extraBytes)
        $password += [Convert]::ToBase64String($extraBytes) -replace '[+/=]', ''
    }

    return $password.Substring(0, $Length)
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Redis ACL Password Generator" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$APP_MAIN_PASS = Generate-SecurePassword -Length 48
$WORKER_PASS = Generate-SecurePassword -Length 48

Write-Host "[+] Generated app_main password ($($APP_MAIN_PASS.Length) chars):" -ForegroundColor Green
Write-Host "    $APP_MAIN_PASS" -ForegroundColor Yellow
Write-Host ""
Write-Host "[+] Generated app_worker password ($($WORKER_PASS.Length) chars):" -ForegroundColor Green
Write-Host "    $WORKER_PASS" -ForegroundColor Yellow
Write-Host ""

# ── Update .env file ──────────────────────────────────────
$envPath = Join-Path $PSScriptRoot '..' '.env'
if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw

    $envContent = $envContent -replace '(?m)^REDIS_PASSWORD=.*$', "REDIS_PASSWORD=$APP_MAIN_PASS"
    $envContent = $envContent -replace '(?m)^REDIS_WORKER_PASSWORD=.*$', "REDIS_WORKER_PASSWORD=$WORKER_PASS"

    Set-Content -Path $envPath -Value $envContent -NoNewline
    Write-Host "[+] Updated .env file" -ForegroundColor Green
} else {
    Write-Host "[!] .env file not found at: $envPath" -ForegroundColor Red
}

# ── Update redis-dev.conf ─────────────────────────────────
$devConfPath = Join-Path $PSScriptRoot '..' 'redis-dev.conf'
if (Test-Path $devConfPath) {
    $devConfContent = Get-Content $devConfPath -Raw

    $devConfContent = $devConfContent -replace '(?m)^user app_main on >\S+', "user app_main on >$APP_MAIN_PASS"
    $devConfContent = $devConfContent -replace '(?m)^user app_worker on >\S+', "user app_worker on >$WORKER_PASS"

    Set-Content -Path $devConfPath -Value $devConfContent -NoNewline
    Write-Host "[+] Updated redis-dev.conf" -ForegroundColor Green
} else {
    Write-Host "[!] redis-dev.conf not found at: $devConfPath" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Next Steps:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Restart Redis: docker compose down && docker compose up -d redis" -ForegroundColor White
Write-Host "  2. Verify: docker exec al-markazia-redis redis-cli PING" -ForegroundColor White
Write-Host "     Expected: NOAUTH Authentication required" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  3. Test app_main: docker exec al-markazia-redis redis-cli --user app_main --pass $APP_MAIN_PASS PING" -ForegroundColor White
Write-Host "     Expected: PONG" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  4. Start backend: npm run dev" -ForegroundColor White
Write-Host ""
