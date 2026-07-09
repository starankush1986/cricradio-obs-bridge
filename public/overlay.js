const params = new URLSearchParams(window.location.search);
let viewMatchId = params.get("matchId") || "";
const audioEnabled = params.get("audio") !== "0";
const obsMode = params.get("obs") === "1";

if (obsMode) {
  document.body.classList.add("obs-mode");
}

const liveListEl = document.getElementById("live-list");
const upcomingListEl = document.getElementById("upcoming-list");
const topDisplayEl = document.getElementById("top-display");
const ratesEl = document.getElementById("rates");
const scoreEl = document.getElementById("score");
const matchTitleEl = document.getElementById("match-title");
const requiredEl = document.getElementById("required");
const batsmenEl = document.getElementById("batsmen");
const bowlerEl = document.getElementById("bowler");

const EVENT_AUDIO_URLS = {
  BALL: "https://freesound.org/data/previews/586/586455_13234060-lq.ogg",
  WICKET: "https://freesound.org/data/previews/586/586597_13234060-lq.ogg",
  0: "https://freesound.org/data/previews/587/587428_13234060-lq.ogg",
  1: "https://freesound.org/data/previews/587/587426_13234060-lq.ogg",
  2: "https://freesound.org/data/previews/587/587431_13234060-lq.ogg",
  3: "https://freesound.org/data/previews/587/587728_13234060-lq.ogg",
  4: "https://freesound.org/data/previews/587/587430_13234060-lq.ogg",
  6: "https://freesound.org/data/previews/587/587432_13234060-lq.ogg",
  WIDE: "https://freesound.org/data/previews/586/586601_13234060-lq.ogg",
  "NO BALL": "https://freesound.org/data/previews/587/587429_13234060-lq.ogg",
};

let lastBallValue = "";
let lastBallVisibleUntil = 0;
let lastPlayedTopEvent = "";
let eventSource = null;
let userPickedMatch = Boolean(viewMatchId);

function formatStartDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractNameFromLine(line) {
  const text = cleanText(line);
  if (!text) {
    return "";
  }
  const match = text.match(/^(.+?)\s+\d+\(\d+\)$/);
  return match ? match[1] : text;
}

function extractBowlerName(line) {
  const text = cleanText(line);
  if (!text) {
    return "";
  }
  const match = text.match(/^(.+?)\s+\d+\s*-\s*\d+/);
  return match ? match[1] : text.split(/\s+\d/)[0];
}

function formatBatsmenSingleLine(names, strikerName) {
  if (!names.length) {
    return "";
  }

  return names
    .map((name) => {
      const isStriker =
        strikerName && cleanText(name) === cleanText(strikerName);
      const light = isStriker ? '<span class="striker-light"></span>' : "";
      return `<span class="batsman-name"><span class="striker-light-slot">${light}</span><span class="batsman-text">${escapeHtml(name)}</span></span>`;
    })
    .join("");
}

function shouldShowRequiredText(text) {
  const value = cleanText(text);
  if (!value) {
    return false;
  }
  return /required|need \d+|target/i.test(value);
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim();
  }
  return String(value).trim();
}

function pickBallValue(...values) {
  for (const value of values) {
    if (value === 0 || value === "0") {
      return "0";
    }
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function capitalizeDisplay(value) {
  if (value === undefined || value === null || value === "") {
    return "&nbsp;";
  }
  const runMatch = String(value).match(/^(\d+)\s*runs?$/i);
  if (runMatch) {
    return runMatch[1];
  }
  if (value === "0" || /^[0-6]$/.test(value)) {
    return value;
  }
  if (value.toUpperCase() === "BALL") {
    return "Ball";
  }
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function setTopClass(value) {
  topDisplayEl.classList.remove("wicket", "four", "six", "wide", "no-ball");
  const upper = (value || "").toUpperCase();
  if (upper.includes("WICKET") || upper === "W") {
    topDisplayEl.classList.add("wicket");
  } else if (upper === "4") {
    topDisplayEl.classList.add("four");
  } else if (upper === "6") {
    topDisplayEl.classList.add("six");
  } else if (upper.startsWith("WIDE")) {
    topDisplayEl.classList.add("wide");
  } else if (upper.startsWith("NO BALL")) {
    topDisplayEl.classList.add("no-ball");
  }
}

function getEventAudioUrl(mappedValue) {
  const key = (mappedValue || "").trim().toUpperCase();
  if (!key) {
    return "";
  }
  if (EVENT_AUDIO_URLS[key]) {
    return EVENT_AUDIO_URLS[key];
  }
  if (key.startsWith("WIDE")) {
    return EVENT_AUDIO_URLS.WIDE;
  }
  if (key.startsWith("NO BALL")) {
    return EVENT_AUDIO_URLS["NO BALL"];
  }
  return "";
}

function playTopDisplayAudio(mappedTopDisplayText) {
  if (!audioEnabled) {
    return;
  }

  const normalizedEvent = (mappedTopDisplayText || "").trim().toUpperCase();
  if (!normalizedEvent || normalizedEvent === lastPlayedTopEvent) {
    return;
  }

  lastPlayedTopEvent = normalizedEvent;
  const audioUrl = getEventAudioUrl(normalizedEvent);
  if (!audioUrl) {
    return;
  }

  const audio = new Audio(audioUrl);
  audio.play().catch(() => {});
}

function renderMatchList(container, items, type, activeId) {
  if (!items.length) {
    container.innerHTML =
      type === "live"
        ? `<div class="empty-list">Live matches auto aayengi</div>`
        : `<div class="empty-list">Upcoming matches auto aayengi</div>`;
    return;
  }

  container.innerHTML = items
    .map((match) => {
      const active = match.matchId === activeId ? "active" : "";
      const liveClass = type === "live" ? "live" : "";
      const meta = [
        match.inningScore || match.teamsLabel,
        type === "upcoming" ? formatStartDate(match.startDate) : "",
      ]
        .filter(Boolean)
        .join(" • ");

      return `
        <button
          class="match-item ${liveClass} ${active}"
          type="button"
          data-match-id="${match.matchId}"
        >
          <div class="title">${match.title}</div>
          <div class="meta">${meta || match.status}</div>
        </button>
      `;
    })
    .join("");

  container.querySelectorAll(".match-item").forEach((button) => {
    button.addEventListener("click", () => {
      selectMatch(button.dataset.matchId);
    });
  });
}

function renderBoard(board) {
  const state = board.state || {};
  const activeId = board.viewMatchId || board.activeMatchId || "";

  renderMatchList(liveListEl, board.live || [], "live", activeId);
  renderMatchList(upcomingListEl, board.upcoming || [], "upcoming", activeId);

  if (!activeId && (board.live || []).length > 0 && !userPickedMatch) {
    selectMatch(board.live[0].matchId);
    return;
  }

  if (!activeId) {
    topDisplayEl.textContent = "Select Match";
    ratesEl.textContent = "";
    scoreEl.innerHTML = "";
    matchTitleEl.textContent = "Live list se match choose karo";
    requiredEl.textContent = "";
    batsmenEl.innerHTML = "";
    bowlerEl.textContent = "";
    return;
  }

  const now = Date.now();

  if (state.isOverBreak) {
    lastBallValue = "";
    lastBallVisibleUntil = 0;
    topDisplayEl.innerHTML = "&nbsp;";
    setTopClass("");
  } else {
    const safeLastBall = pickBallValue(
      state.lastBall,
      state.ballToken,
      state.topDisplay,
      state.ballEvent,
    );
    if (safeLastBall !== "" && safeLastBall !== lastBallValue) {
      lastBallValue = safeLastBall;
      lastBallVisibleUntil = now + 5000;
    }

    const shouldShowLastBall = safeLastBall !== "" && now <= lastBallVisibleUntil;
    const topDisplayText = shouldShowLastBall
      ? pickBallValue(state.topDisplay, state.ballEvent, safeLastBall)
      : pickBallValue(state.topDisplay, state.ballEvent, state.over);

    const mappedTop = topDisplayText || "";
    topDisplayEl.innerHTML =
      mappedTop === "0" || mappedTop ? capitalizeDisplay(mappedTop) : "&nbsp;";
    setTopClass(mappedTop);
    playTopDisplayAudio(mappedTop);
  }

  const ratesText = state.rates || [
    state.crr ? `CRR: ${state.crr}` : "",
    state.rrr ? `RRR: ${state.rrr}` : "",
  ]
    .filter(Boolean)
    .join("  ");

  ratesEl.textContent = ratesText || "";
  ratesEl.classList.toggle("hidden-line", !ratesText);

  scoreEl.innerHTML = state.scoreHtml || "";
  matchTitleEl.textContent = "";
  matchTitleEl.classList.add("hidden-line");

  const requiredText = cleanText(state.required || "");
  requiredEl.textContent = requiredText;
  requiredEl.classList.toggle("hidden-line", !requiredText);

  const batsmanNames =
    (state.batsmanNames || []).filter(Boolean).length > 0
      ? (state.batsmanNames || []).filter(Boolean)
      : (state.batsmen || []).map(extractNameFromLine).filter(Boolean);

  const bowlerName =
    cleanText(state.bowlerName) || extractBowlerName(state.bowler || "");

  batsmenEl.innerHTML = batsmanNames.length
    ? formatBatsmenSingleLine(batsmanNames, state.strikerName)
    : "";
  batsmenEl.classList.toggle("hidden-line", batsmanNames.length === 0);

  bowlerEl.textContent = bowlerName;
  bowlerEl.classList.toggle("hidden-line", !bowlerName);

  if (state.status === "notstarted" && !state.scoreHtml) {
    topDisplayEl.textContent = "Waiting";
  }
}

async function selectMatch(matchId) {
  if (!matchId) {
    return;
  }

  userPickedMatch = true;
  viewMatchId = matchId;

  const response = await fetch("/api/active-match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId }),
  });
  const board = await response.json();
  renderBoard(board);
  connectStream();
}

async function loadInitial() {
  const url = viewMatchId
    ? `/api/state?matchId=${encodeURIComponent(viewMatchId)}`
    : "/api/state";
  const response = await fetch(url);
  renderBoard(await response.json());
}

function connectStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  const streamUrl = viewMatchId
    ? `/events?matchId=${encodeURIComponent(viewMatchId)}`
    : "/events";
  eventSource = new EventSource(streamUrl);

  eventSource.onmessage = (event) => {
    try {
      renderBoard(JSON.parse(event.data));
    } catch (error) {
      console.error("Bad SSE payload", error);
    }
  };

  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
    setTimeout(connectStream, 2000);
  };
}

loadInitial();
connectStream();
