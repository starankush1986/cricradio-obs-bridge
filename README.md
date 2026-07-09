# CricRadio OBS Bridge

## Quick Start

```bash
cd obs-bridge
npm start
```

Overlay: **http://localhost:3456/overlay.html** — OBS size: **1280 × 720**

## DigitalOcean (deployed)

- **Overlay (stable IP):** http://188.166.196.40/overlay.html?obs=1
- **Health:** http://188.166.196.40/api/health
- **Region:** Singapore (`sgp1`)
- **GitHub:** https://github.com/starankush1986/cricradio-obs-bridge

OBS Browser Source size: **1280 × 720**

Redeploy after code changes:
```bash
git push origin main
ssh root@134.209.106.254 "cd /var/www/cricradio-obs-bridge && git pull && npm ci --omit=dev && pm2 restart cricradio-obs-bridge"
```

## How it works

- **Live** and **Upcoming** matches CricRadio se **automatic** aate hain
  - API: `match/list` (har 30 sec)
  - Socket: `global` room + `match-list-c-e`
- **Live list** se match par click karo → uska score right panel mein dikhega
- Manual match ID add karne ki zaroorat nahi
