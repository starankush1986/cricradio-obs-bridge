const fs = require("fs");
const path = require("path");
const express = require("express");
const { io } = require("socket.io-client");
const { MatchManager } = require("./lib/match-manager");

const configPath = path.join(__dirname, "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const PORT = Number(process.env.PORT || config.port || 3456);
const SOCKET_URL = "https://socket.cricradio.com.au";
const WATCH_MATCH_IDS = Array.from(
  new Set([
    ...(config.watchMatchIds || []),
    ...(config.matchId ? [config.matchId] : []),
  ]),
);

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.redirect("/overlay.html?obs=1");
});

app.use(express.static(path.join(__dirname, "public")));

const manager = new MatchManager();
const sseClients = new Map(); // response -> viewMatchId
let cricSocket = null;

function publishState() {
  for (const [client, viewMatchId] of sseClients.entries()) {
    const payload = manager.getBoardPayload(viewMatchId);
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

manager.setOnChange(publishState);

function connectCricRadioSocket() {
  if (cricSocket) {
    cricSocket.disconnect();
    cricSocket = null;
  }

  const socket = io(SOCKET_URL, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    transports: ["websocket", "polling"],
  });

  manager.setSocket(socket);
  manager.bindGlobalSocketHandlers();

  socket.on("connect", () => {
    console.log("CricRadio socket connected");
    manager.onSocketConnect();
    publishState();
  });

  socket.on("disconnect", () => {
    console.log("CricRadio socket disconnected");
    publishState();
  });

  socket.on("connect_error", (error) => {
    console.error("Socket connect error:", error.message);
    publishState();
  });

  cricSocket = socket;
  return socket;
}

app.get("/api/matches", (_req, res) => {
  const { live, upcoming } = manager.getCategorizedLists();
  res.json({
    activeMatchId: manager.activeMatchId,
    live,
    upcoming,
  });
});

app.get("/api/state", (req, res) => {
  res.json(manager.getBoardPayload(cleanQuery(req.query.matchId)));
});

app.get("/api/health", (_req, res) => {
  const { live, upcoming } = manager.getCategorizedLists();
  res.json({
    ok: true,
    activeMatchId: manager.activeMatchId,
    liveCount: live.length,
    upcomingCount: upcoming.length,
    socketConnected: Boolean(cricSocket?.connected),
    live,
    upcoming,
  });
});

app.post("/api/active-match", async (req, res) => {
  const matchId = cleanQuery(req.body?.matchId);
  if (!matchId) {
    res.status(400).json({ ok: false, error: "matchId required" });
    return;
  }

  try {
    const ok = await manager.selectMatch(matchId);
    res.json({
      ok,
      ...manager.getBoardPayload(matchId),
    });
  } catch (error) {
    trackError(res, error);
  }
});

app.post("/api/watch", async (req, res) => {
  const matchId = cleanQuery(req.body?.matchId);
  if (!matchId) {
    res.status(400).json({ ok: false, error: "matchId required" });
    return;
  }

  try {
    await manager.selectMatch(matchId);
    res.json({ ok: true, ...manager.getBoardPayload(matchId) });
  } catch (error) {
    trackError(res, error);
  }
});

app.get("/events", (req, res) => {
  const viewMatchId = cleanQuery(req.query.matchId) || manager.activeMatchId;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  sseClients.set(res, viewMatchId);
  res.write(`data: ${JSON.stringify(manager.getBoardPayload(viewMatchId))}\n\n`);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

function cleanQuery(value) {
  return typeof value === "string" ? value.trim() : "";
}

function trackError(res, error) {
  res.status(500).json({ ok: false, error: error.message });
}

async function start() {
  console.log("CricRadio OBS Bridge");
  console.log(`Overlay: http://localhost:${PORT}/overlay.html`);

  connectCricRadioSocket();

  if (WATCH_MATCH_IDS.length > 0) {
    await manager.watchMatches(WATCH_MATCH_IDS);
  }

  const discovered = await manager.refreshMatchListFromApi();
  console.log(`API match/list returned ${discovered} matches`);

  if (!manager.activeMatchId) {
    const live = manager.getCategorizedLists().live[0];
    if (live) {
      await manager.selectMatch(live.matchId);
    }
  }

  setInterval(async () => {
    await manager.refreshMatchListFromApi();
    await manager.refreshLiveDetailsForStartedMatches();
  }, 15000);

  app.listen(PORT, "0.0.0.0", () => {
    const { live, upcoming } = manager.getCategorizedLists();
    console.log(`Server running on port ${PORT}`);
    console.log(`Overlay: /overlay.html`);
    console.log(`Live: ${live.length}, Upcoming: ${upcoming.length}`);
  });
}

start().catch((error) => {
  console.error("Failed to start:", error);
  process.exit(1);
});
