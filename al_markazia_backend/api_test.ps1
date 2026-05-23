Write-Host "=== HEALTH CHECK ==="
curl.exe -s http://localhost:5000/health

Write-Host "`n=== AUTH ENDPOINT ==="
curl.exe -s -X POST http://localhost:5000/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"test@test.com","password":"wrongpass"}'

Write-Host "`n=== LEGACY AUTH ENDPOINT ==="
curl.exe -s -X POST http://localhost:5000/auth/login -H "Content-Type: application/json" -d '{"email":"test@test.com","password":"wrongpass"}'

Write-Host "`n=== CHECK WHICH PORT BACKEND IS USING ==="
netstat -ano | findstr :5000 | findstr LISTENING

Write-Host "`n=== CORS HEADERS TEST ==="
curl.exe -s -I -X OPTIONS http://localhost:5000/api/v1/auth/login -H "Origin: https://al-markazia.duckdns.org" | findstr -i "access-control"
