#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "Starting VM Configuration Setup"
echo "=========================================="

# 1. Update APT Packages
echo "Updating packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

# 2. Setup 2GB Swap file (Required for 1GB RAM VM)
echo "Setting up 2GB Swap file..."
if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "Swap file created successfully!"
else
    echo "Swap file already exists, skipping creation."
fi

# 3. Install Docker and Docker Compose
echo "Installing Docker and Docker Compose..."
sudo apt-get install -y ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
fi

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 4. Configure Docker Permissions
echo "Configuring Docker permissions for azureuser..."
sudo usermod -aG docker azureuser

# 5. Verify Installations
echo "Verifying installations..."
docker --version
docker compose version

echo "=========================================="
echo "VM Configuration Setup Completed successfully!"
echo "Please log out and log back in to apply docker group changes."
echo "=========================================="
