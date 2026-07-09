# CricRadio OBS Bridge

## Quick Start

```bash
cd obs-bridge
npm start
```

Overlay: **http://localhost:3456/overlay.html** — OBS size: **1280 × 720**

OBS Browser Source (sidebar hide, score only): **http://localhost:3456/overlay.html?obs=1** — size: **1280 × 720**

## How it works

- **Live** and **Upcoming** matches CricRadio se **automatic** aate hain
  - API: `match/list` (har 30 sec)
  - Socket: `global` room + `match-list-c-e`
- **Live list** se match par click karo → uska score right panel mein dikhega
- Manual match ID add karne ki zaroorat nahi
