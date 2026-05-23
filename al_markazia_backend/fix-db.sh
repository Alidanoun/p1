docker exec al-markazia-prod-db psql -U admin -d al_markazia_prod_db -c "ALTER USER admin WITH PASSWORD '0623590fac3710469d308a9f86319436';"
cd /home/azureuser/al_markazia_backend
docker compose -f docker-compose.production.yml run --rm app sh -c 'npx dotenvx run -f .env.production -- npx prisma migrate deploy'
docker compose -f docker-compose.production.yml up -d
