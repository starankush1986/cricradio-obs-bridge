$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
$DropletName = "cricradio-obs-bridge"
$Region = "sgp1"
$Size = "s-1vcpu-512mb-10gb"
$SshKeyIds = @("57552835")

Write-Host "Creating droplet $DropletName in $Region..."
$createJson = doctl compute droplet create $DropletName `
  --region $Region `
  --size $Size `
  --image ubuntu-24-04-x64 `
  --ssh-keys ($SshKeyIds -join ",") `
  --user-data-file (Join-Path $PSScriptRoot "cloud-init.yaml") `
  --wait `
  --format ID,Name,PublicIPv4 `
  --output json | ConvertFrom-Json

$dropletId = $createJson[0].id
$ip = $createJson[0].public_ipv4
Write-Host "Droplet ID: $dropletId"
Write-Host "Public IP: $ip"

Write-Host "Waiting for SSH..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 10
  $result = ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@$ip "node -v" 2>$null
  if ($LASTEXITCODE -eq 0) {
    $ready = $true
    break
  }
  Write-Host "SSH not ready yet..."
}

if (-not $ready) {
  throw "SSH did not become ready in time."
}

Write-Host "Uploading app files..."
ssh -o StrictHostKeyChecking=no root@$ip "rm -rf /var/www/cricradio-obs-bridge/*"
scp -o StrictHostKeyChecking=no -r `
  (Join-Path $Root "package.json") `
  (Join-Path $Root "package-lock.json") `
  (Join-Path $Root "server.js") `
  (Join-Path $Root "config.json") `
  root@${ip}:/var/www/cricradio-obs-bridge/
scp -o StrictHostKeyChecking=no -r `
  (Join-Path $Root "lib") `
  (Join-Path $Root "public") `
  root@${ip}:/var/www/cricradio-obs-bridge/

scp -o StrictHostKeyChecking=no (Join-Path $PSScriptRoot "nginx-cricradio.conf") root@${ip}:/etc/nginx/sites-available/cricradio-obs-bridge

$remoteSetup = @'
set -e
cd /var/www/cricradio-obs-bridge
export NODE_ENV=production
export PORT=8080
npm ci --omit=dev
pm2 delete cricradio-obs-bridge 2>/dev/null || true
pm2 start server.js --name cricradio-obs-bridge --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
ln -sf /etc/nginx/sites-available/cricradio-obs-bridge /etc/nginx/sites-enabled/cricradio-obs-bridge
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
'@

ssh -o StrictHostKeyChecking=no root@$ip $remoteSetup

Write-Host ""
Write-Host "Deployed successfully!"
Write-Host "Overlay: http://$ip/overlay.html"
Write-Host "OBS mode: http://$ip/overlay.html?obs=1"
Write-Host "Health: http://$ip/api/health"
