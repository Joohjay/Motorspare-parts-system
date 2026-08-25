#!/usr/bin/env bash
# JM SPAREPARTS — Production deployment script
# Usage: ./scripts/deploy.sh
#
# This script:
# 1. Installs server dependencies
# 2. Builds the server (tsc)
# 3. Builds the client (vite build)
# 4. Generates Prisma client
# 5. Runs database migrations
# 6. Restarts the PM2 process
#
# Prerequisites:
# - Node.js >= 20.19 installed
# - PostgreSQL running and accessible
# - server/.env configured with production values
# - PM2 installed globally (npm install -g pm2)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_DIR="$ROOT_DIR/server"
CLIENT_DIR="$ROOT_DIR/client"

echo "============================================="
echo "JM SPAREPARTS — Production Deployment"
echo "============================================="

# Step 1: Install dependencies
echo ""
echo "[1/6] Installing server dependencies..."
cd "$SERVER_DIR"
npm ci --omit=dev

echo ""
echo "[1/6] Installing client dependencies..."
cd "$CLIENT_DIR"
npm ci

# Step 2: Build server
echo ""
echo "[2/6] Building server..."
cd "$SERVER_DIR"
npm run build

# Step 3: Build client
echo ""
echo "[3/6] Building client..."
cd "$CLIENT_DIR"
npm run build

# Step 4: Generate Prisma client
echo ""
echo "[4/6] Generating Prisma client..."
cd "$SERVER_DIR"
npx prisma generate

# Step 5: Run migrations
echo ""
echo "[5/6] Running database migrations..."
npx prisma migrate deploy

# Step 6: Restart PM2 process
echo ""
echo "[6/6] Restarting PM2 process..."
cd "$ROOT_DIR"
pm2 restart jm-spareparts-api || pm2 start ecosystem.config.js

echo ""
echo "============================================="
echo "Deployment complete!"
echo "============================================="
echo ""
echo "Verify:"
echo "  curl http://localhost:4000/api/health"
echo "  pm2 status"
echo "  pm2 logs jm-spareparts-api --lines 20"
