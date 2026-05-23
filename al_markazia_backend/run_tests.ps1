$output = @()
$output += "=== POSTGRES CONTAINER ==="
$out1 = docker exec al-markazia-db psql -U admin -d al_markazia_db -c "\dt" 2>&1
if ($LASTEXITCODE -ne 0) { $output += "❌ Cannot connect to DB container" } else { $output += $out1 }

$output += ""
$output += "=== PRISMA MIGRATIONS ==="
$out2 = npx @dotenvx/dotenvx run -- npx prisma migrate status 2>&1
if ($LASTEXITCODE -ne 0) { $output += $out2 } else { $output += $out2 }

$output += ""
$output += "=== DB CONNECTION TEST ==="
$script = "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); p.`$queryRaw``SELECT COUNT(*) FROM `"User`"``.then(r => { console.log('✅ DB Connected. Users:', Number(r[0].count)); p.`$disconnect(); }).catch(e => { console.log('❌ DB Error:', e.message); p.`$disconnect(); });"
$out3 = npx @dotenvx/dotenvx run -- node -e $script 2>&1
if ($LASTEXITCODE -ne 0) { $output += $out3 } else { $output += $out3 }

$output += ""
$output += "=== REDIS PING ==="
$out4 = docker exec al-markazia-redis redis-cli ping 2>&1
if ($LASTEXITCODE -ne 0) { $output += "❌ Redis not responding" } else { $output += $out4 }

$output | Out-File -FilePath test_report.txt -Encoding utf8
