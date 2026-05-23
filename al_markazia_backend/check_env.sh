#!/bin/bash
echo "=== CORS_ORIGIN ==="
npx @dotenvx/dotenvx run -f .env.production -- node -e "console.log(process.env.CORS_ORIGIN)"
echo ""
echo "=== COOKIE DEBUG (sameSite) ==="
grep "sameSite" src/controllers/authController.js
echo ""
echo "=== DB AUTH CHECK ==="
docker exec al-markazia-prod-db psql -U admin -d al_markazia_prod_db -c "SELECT id, email, role FROM \"User\" LIMIT 3;"
