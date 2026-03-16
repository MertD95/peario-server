#!/bin/bash
# Quick update script — pull latest code, rebuild, restart
# Run from the repo directory on your local machine, or on the server itself
#
# Usage (from server): cd /opt/watchparty-server && bash deploy/update.sh
# Usage (from local):  ssh your-vm "cd /opt/watchparty-server && bash deploy/update.sh"

set -e

APP_DIR="/opt/watchparty-server"

echo "=== Updating WatchParty Server ==="

cd "$APP_DIR"

# If this is a git repo, pull latest
if [ -d ".git" ]; then
    echo "Pulling latest changes..."
    git pull
fi

echo "Installing dependencies..."
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

echo "Building..."
npx --package=typescript tsc

echo "Restarting service..."
sudo systemctl restart watchparty-server

echo "=== Update complete ==="
sudo systemctl status watchparty-server --no-pager
