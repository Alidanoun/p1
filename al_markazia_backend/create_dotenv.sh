#!/bin/bash
# Create .env file for docker-compose to use real values

cd ~/al_markazia_backend

# Create the .env file that docker-compose reads automatically
cat > .env << 'EOF'
REDIS_PASSWORD=redis_production_secure_password_32_chars
REDIS_WORKER_PASSWORD=redis_production_secure_worker_password_32_chars
POSTGRES_USER=admin
POSTGRES_PASSWORD=0623590fac3710469d308a9f86319436
POSTGRES_DB=al_markazia_prod_db
EOF

echo "✅ .env file created"
cat .env
