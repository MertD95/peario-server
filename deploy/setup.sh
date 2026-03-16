#!/bin/bash
# Oracle Cloud VM setup script for WatchParty Server
# Run this once on a fresh Ubuntu VM (Oracle Cloud free tier ARM instance)
#
# Usage: ssh into your VM, then:
#   curl -fsSL https://raw.githubusercontent.com/<your-repo>/main/deploy/setup.sh | bash
# Or clone the repo and run: bash deploy/setup.sh

set -e

APP_DIR="/opt/watchparty-server"
APP_USER="watchparty"
NODE_VERSION="22"

echo "=== WatchParty Server Setup ==="

# Install Node.js
if ! command -v node &> /dev/null; then
    echo "Installing Node.js ${NODE_VERSION}..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "Node.js $(node -v)"

# Create app user (no login shell)
if ! id "$APP_USER" &>/dev/null; then
    echo "Creating user ${APP_USER}..."
    sudo useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
fi

# Create app directory
sudo mkdir -p "$APP_DIR"
sudo chown "$APP_USER":"$APP_USER" "$APP_DIR"

# Copy project files (if running from repo)
if [ -f "package.json" ]; then
    echo "Copying project files..."
    sudo cp -r package.json package-lock.json src tsconfig.json "$APP_DIR/"
    sudo chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
fi

# Install dependencies and build
echo "Installing dependencies..."
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --omit=dev 2>/dev/null || sudo -u "$APP_USER" npm install --omit=dev
sudo -u "$APP_USER" npx --package=typescript tsc

# Create .env if it doesn't exist
if [ ! -f "$APP_DIR/.env" ]; then
    echo "Creating .env..."
    sudo -u "$APP_USER" tee "$APP_DIR/.env" > /dev/null <<EOF
PORT=8181
INTERVAL_ROOM_UPDATE=30000
PING_INTERVAL=30000
MAX_CONNECTIONS=10000
MAX_CONNECTIONS_PER_IP=10
LOG_LEVEL=info
NODE_ENV=production
EOF
fi

# Install systemd service
echo "Installing systemd service..."
sudo cp "$(dirname "$0")/watchparty-server.service" /etc/systemd/system/ 2>/dev/null || \
sudo tee /etc/systemd/system/watchparty-server.service > /dev/null <<EOF
[Unit]
Description=WatchParty Server
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=$(which node) dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable watchparty-server
sudo systemctl restart watchparty-server

# Open firewall port
echo "Opening port 8181..."
sudo iptables -I INPUT -p tcp --dport 8181 -j ACCEPT
# Persist iptables rules
sudo sh -c "iptables-save > /etc/iptables/rules.v4" 2>/dev/null || true

echo ""
echo "=== Setup complete ==="
echo "Server running on port 8181"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status watchparty-server    # Check status"
echo "  sudo journalctl -u watchparty-server -f    # View logs"
echo "  sudo systemctl restart watchparty-server   # Restart"
echo ""
echo "IMPORTANT: In Oracle Cloud console, add an ingress rule"
echo "for port 8181 (TCP) in your VCN security list."
echo ""
echo "Your client should connect to: ws://<your-vm-public-ip>:8181"
echo "(Or use a reverse proxy like Caddy/nginx for wss://)"
