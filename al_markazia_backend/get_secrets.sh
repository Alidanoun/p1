#!/bin/bash
cd ~/al_markazia_backend
docker exec al-markazia-prod-app npx @dotenvx/dotenvx run -f .env.production -- node -e "
const vars = ['REDIS_PASSWORD','REDIS_WORKER_PASSWORD','POSTGRES_PASSWORD','POSTGRES_USER','POSTGRES_DB'];
vars.forEach(v => console.log(v + '=' + process.env[v]));
"
