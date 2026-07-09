#!/bin/bash
set -euo pipefail

APP_DIR=/var/www/cricradio-obs-bridge
cd "$APP_DIR"

export NODE_ENV=production
export PORT=8080

npm ci --omit=dev

pm2 delete cricradio-obs-bridge 2>/dev/null || true
pm2 start server.js --name cricradio-obs-bridge --update-env
pm2 save
pm2 startup systemd -u root --hp /root | tail -n 1 | bash || true

cp deploy/nginx-cricradio.conf /etc/nginx/sites-available/cricradio-obs-bridge
ln -sf /etc/nginx/sites-available/cricradio-obs-bridge /etc/nginx/sites-enabled/cricradio-obs-bridge
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
systemctl enable nginx

echo "cricradio-obs-bridge ready" > /var/log/cricradio-deploy.log
