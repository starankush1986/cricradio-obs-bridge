const AUTH =
  "Basic Y3JpY2tldFJhZGlvOmNyaWNrZXRAJCUjUmFkaW8xMjM=";
const API_BASE = "https://server.cricradio.com.au/api/v2";

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim();
  }
  return "";
}

function pickText(...values) {
  for (const value of values) {
    if (value === 0 || value === "0") {
      return "0";
    }
    const text = cleanText(value);
    if (text !== "") {
      return text;
    }
  }
  return "";
}

function extractRunDigit(value) {
  const raw = cleanText(value);
  if (!raw) {
    return "";
  }
  const runMatch = raw.match(/^(\d+)\s*runs?$/i);
  if (runMatch) {
    return runMatch[1];
  }
  if (/^[0-6]$/.test(raw)) {
    return raw;
  }
  return "";
}

function isBreakText(value) {
  const lower = cleanText(value).toLowerCase();
  if (!lower) {
    return false;
  }
  return /over break|overs break|drinks break|innings break|lunch break|tea break|strategic timeout|rain(?:\s+)?(?:interrupted|delay)|match delay|stumps/.test(
    lower,
  );
}

function isSingleBallRunText(value) {
  const raw = cleanText(value);
  if (!raw) {
    return false;
  }
  if (/^[0-6]$/.test(raw)) {
    return true;
  }
  if (/^[0-6]\s*runs?$/i.test(raw)) {
    return true;
  }
  return /^[0-6]runs?$/i.test(raw.replace(/\s+/g, ""));
}

function isOverRunsSummary(value) {
  const raw = cleanText(value);
  if (!raw || isSingleBallRunText(raw)) {
    return false;
  }
  const match = raw.match(/^(\d+)\s+runs?$/i);
  if (!match) {
    return false;
  }
  return Number(match[1]) > 6;
}

function isOverBreak(match, commentary = {}) {
  if (match?.break) {
    return true;
  }

  const texts = [
    match?.announcement1,
    match?.announcement2,
    commentary?.primaryText,
    commentary?.primary,
    commentary?.secondaryText,
    commentary?.secondary,
    commentary?.tertiaryText,
    commentary?.tertiary,
  ];

  if (texts.some(isBreakText)) {
    return true;
  }

  const primary = pickText(commentary?.primaryText, commentary?.primary);
  if (isSingleBallRunText(primary)) {
    return false;
  }
  return isOverRunsSummary(primary);
}

function getTeamScoreBlock(teamObj, teamKey, inning) {
  if (!teamObj) {
    return null;
  }

  const scoreKey = `${teamKey}_${inning}_score`;
  const score = teamObj[scoreKey];
  if (!score) {
    return null;
  }

  const name =
    cleanText(teamObj.short_name) ||
    cleanText(teamObj.shortName) ||
    cleanText(teamObj.name) ||
    teamKey.toUpperCase();

  return {
    key: teamKey,
    name,
    runs: score.runs ?? 0,
    wickets: score.wickets ?? 0,
    overs: cleanText(score.overs),
    score: `${score.runs ?? 0}-${score.wickets ?? 0}`,
  };
}

function getAllTeamScores(match) {
  const teams = match?.teams || {};
  const setting = match?.settingObj || {};
  const currentInning = Number(setting.currentInning || 1);
  const blocks = [];

  for (const teamKey of ["a", "b"]) {
    const current = getTeamScoreBlock(teams[teamKey], teamKey, currentInning);
    if (current) {
      blocks.push(current);
      continue;
    }

    for (let inning = 1; inning <= 5; inning += 1) {
      const block = getTeamScoreBlock(teams[teamKey], teamKey, inning);
      if (block && (block.runs > 0 || block.overs)) {
        blocks.push(block);
      }
    }
  }

  const seen = new Set();
  return blocks.filter((block) => {
    const id = `${block.key}-${block.score}-${block.overs}`;
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function extractPlayerName(player, fallbackName = "") {
  if (!player) {
    return "";
  }
  if (typeof player === "string") {
    const match = player.match(/^(.+?)\s+\d+\(\d+\)$/);
    return cleanText(match ? match[1] : player);
  }
  return (
    cleanText(player.fullname) ||
    cleanText(player.name) ||
    cleanText(fallbackName)
  );
}

function formatBowlerName(bowler) {
  if (!bowler) {
    return "";
  }
  if (typeof bowler === "string") {
    const match = bowler.match(/^(.+?)\s+\d+\s*-\s*\d+/);
    return cleanText(match ? match[1] : bowler.split(/\s+\d/)[0]);
  }
  return cleanText(bowler.fullname) || cleanText(bowler.name);
}

function formatPlayerLine(player, fallbackName) {
  if (!player) {
    return "";
  }

  const batting = player.batting || player;
  const name =
    cleanText(player.fullname) ||
    cleanText(player.name) ||
    cleanText(fallbackName);
  const runs = batting.runs ?? player.runs ?? player.player_a_runs ?? "";
  const balls = batting.balls ?? player.balls ?? player.player_a_balls ?? "";
  if (!name) {
    return "";
  }
  if (runs === "" && balls === "") {
    return name;
  }
  return `${name} ${runs}(${balls})`;
}

function formatBowlerLine(bowler) {
  if (!bowler) {
    return "";
  }

  const bowling = bowler.bowling || bowler;
  const name = cleanText(bowler.fullname) || cleanText(bowler.name);
  const wickets = bowling.wickets ?? bowler.wickets ?? "";
  const runs = bowling.runs ?? bowler.runs ?? "";
  const overs = bowling.overs ?? bowler.overs ?? bowler.innOvers ?? "";
  if (!name) {
    return "";
  }
  if (wickets === "" && runs === "") {
    return name;
  }
  return `${name} ${wickets}-${runs}${overs ? `(${overs})` : ""}`;
}

function getShortTeamName(teamName) {
  const text = cleanText(teamName);
  if (!text) {
    return "";
  }
  const words = text.split(/\s+/);
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  return words
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("");
}

function formatTeamsScoreHtml(match, teams) {
  if (!teams.length) {
    return "";
  }

  const lines = teams.map((team) => {
    const overs = team.overs ? ` (${team.overs})` : "";
    const short = getShortTeamName(team.name) || team.name;
    return `<div>${short} ${team.score}${overs}</div>`;
  });

  return lines.join("");
}

function normalizeTopDisplayEvent(value) {
  const raw = cleanText(value);
  if (!raw) {
    return "";
  }

  const lower = raw.toLowerCase();
  const runDigit = extractRunDigit(raw);
  if (runDigit) {
    return runDigit;
  }
  const map = {
    w: "WICKET",
    wd: "WIDE",
    "0wd": "WIDE",
    "1wd": "WIDE+1",
    "4wd": "WIDE+4",
    nb: "No Ball",
    "0nb": "No Ball",
    "1nb": "No Ball",
    "ball start": "Ball",
    "ball chalu": "Ball",
    ball: "Ball",
    "dot ball": "0",
    dotball: "0",
    dot: "0",
    d: "0",
  };

  if (map[lower]) {
    return map[lower];
  }
  if (/^dot\s*ball|^dotball|^dot$|no\s*run/.test(lower) || raw === "d") {
    return "0";
  }
  if (/^ball\s*start|^ball\s*chalu|^ball$/.test(lower)) {
    return "Ball";
  }
  if (/wicket|out\b/.test(lower)) {
    return "WICKET";
  }
  if (/^wide/.test(lower)) {
    return "Wide";
  }
  if (/^no\s*ball/.test(lower)) {
    return "No Ball";
  }
  if (/^leg\s*bye/.test(lower)) {
    return "Leg Bye";
  }
  if (/^bye/.test(lower)) {
    return "Bye";
  }
  return raw;
}

function buildRequiredText(match) {
  const msgs = match?.msgs || {};
  const now = match?.now || {};

  const chaseLine = cleanText(msgs.result || msgs.required || now.reqWinText);
  if (chaseLine) {
    return chaseLine;
  }

  const computed = computeChaseText(match);
  if (computed) {
    return computed;
  }

  const announcement = cleanText(match?.announcement1);
  if (announcement && /required|need \d+|target/i.test(announcement)) {
    return announcement;
  }

  return "";
}

function computeChaseText(match) {
  const now = match?.now || {};
  const target = now.target || {};
  const targetRuns = Number(target.runs);
  if (!Number.isFinite(targetRuns) || targetRuns <= 0) {
    return "";
  }

  const teams = getAllTeamScores(match);
  const setting = match?.settingObj || {};
  const currentTeam = teams.find((team) => team.key === setting.currentTeam) || teams[0];
  if (!currentTeam) {
    return "";
  }

  const runsNeeded = Math.max(targetRuns - Number(currentTeam.runs || 0), 0);
  const totalBalls = Number(target.balls);
  if (!Number.isFinite(totalBalls) || totalBalls <= 0) {
    return `${currentTeam.name} need ${runsNeeded} runs`;
  }

  const oversDecimal = parseOversDecimal(currentTeam.overs);
  const ballsFaced = Math.round(oversDecimal * 6);
  const ballsLeft = Math.max(totalBalls - ballsFaced, 0);
  return `${currentTeam.name} need ${runsNeeded} runs in ${ballsLeft} balls`;
}

function parseOversDecimal(value) {
  const text = cleanText(value);
  if (!text) {
    return 0;
  }
  const [oversPart, ballsPart] = text.split(".");
  const overs = Number(oversPart);
  const balls = Number(ballsPart || 0);
  if (Number.isNaN(overs)) {
    return 0;
  }
  return overs + (Number.isNaN(balls) ? 0 : balls) / 6;
}

function normalizeBallEvent(text) {
  const raw = cleanText(text);
  if (!raw) {
    return "";
  }

  const lower = raw.toLowerCase();
  const runDigit = extractRunDigit(raw);
  if (runDigit) {
    return runDigit;
  }
  if (/^dot\s*ball|^dotball|^dot$|no\s*run/.test(lower) || raw === "d") {
    return "0";
  }
  if (/^ball\s*start|^ball\s*chalu|^ball$/.test(lower)) {
    return "Ball";
  }
  if (/wicket|\bout\b/.test(lower)) {
    return "WICKET";
  }
  if (/^wide/.test(lower) || raw === "WD") {
    return "WIDE";
  }
  if (/^no\s*ball/.test(lower) || raw === "NB") {
    return "NO BALL";
  }
  if (/^leg\s*bye/.test(lower)) {
    return "LEG BYE";
  }
  if (/^bye/.test(lower)) {
    return "BYE";
  }
  if (/^[0-6]$/.test(raw)) {
    return raw;
  }
  return raw.toUpperCase();
}

function extractBallFromCommentary(commentary) {
  const primary = pickText(commentary?.primaryText, commentary?.primary);
  const secondary = pickText(commentary?.secondaryText, commentary?.secondary);
  const tertiary = pickText(commentary?.tertiaryText, commentary?.tertiary);
  const full = [primary, secondary, tertiary]
    .filter((part) => part !== "")
    .join(" ");

  let token = "";
  const tokenMatch = full.match(/^\d+\.\d+\s*([A-Za-z0-9+]+)/);
  if (tokenMatch) {
    token = tokenMatch[1];
  } else if (/wicket|out/i.test(full)) {
    token = "W";
  } else if (/wide/i.test(full)) {
    token = "WD";
  } else if (/no ball/i.test(full)) {
    token = "NB";
  } else if (/dot\s*ball|dotball|\bdot\b|no\s*run/i.test(full)) {
    token = "0";
  } else if (/ball\s*start|ball\s*chalu/i.test(full)) {
    token = "Ball";
  } else {
    const runsMatch = full.match(/:\s*(\d+)\s*runs?/i);
    token = runsMatch ? runsMatch[1] : "";
  }

  if (!token) {
    token = pickText(primary);
  }

  const event = normalizeBallEvent(token || primary);

  return {
    token: token || (event === "0" ? "0" : ""),
    event,
    text: full || primary,
  };
}

function mergeMatchState(current, patch) {
  if (!patch) {
    return current;
  }

  const next = { ...current, ...patch };

  if (patch.teams) {
    next.teams = {
      ...(current.teams || {}),
      ...patch.teams,
    };

    for (const teamKey of Object.keys(patch.teams)) {
      next.teams[teamKey] = {
        ...(current.teams?.[teamKey] || {}),
        ...patch.teams[teamKey],
      };
    }
  }

  if (patch.now) {
    next.now = { ...(current.now || {}), ...patch.now };
  }

  if (patch.settingObj) {
    next.settingObj = { ...(current.settingObj || {}), ...patch.settingObj };
  }

  if (patch.msgs) {
    next.msgs = { ...(current.msgs || {}), ...patch.msgs };
  }

  if (patch.lastCommentary) {
    next.lastCommentary = {
      ...(current.lastCommentary || {}),
      ...patch.lastCommentary,
    };
  }

  return next;
}

function buildOverlayState(match, meta = {}) {
  const teams = getAllTeamScores(match);
  const now = match?.now || {};
  const commentary = match?.lastCommentary || {};
  const ball = extractBallFromCommentary(commentary);
  const setting = match?.settingObj || {};
  const currentTeam = setting.currentTeam || "a";
  const currentTeamBlock = teams.find((team) => team.key === currentTeam);

  const batsmen = [
    formatPlayerLine(now.striker || now.player_a, "Striker"),
    formatPlayerLine(now.nonstriker || now.player_b, "Non-striker"),
  ].filter(Boolean);

  const batsmanNames = [
    extractPlayerName(now.striker || now.player_a),
    extractPlayerName(now.nonstriker || now.player_b),
  ].filter(Boolean);

  const bowler = formatBowlerLine(now.bowler || now.lastBowler);
  const bowlerName = formatBowlerName(now.bowler || now.lastBowler);
  const rates = [now.crr || now.run_rate || now.current_run_rate, now.rrr || now.req_run_rate]
    .filter(Boolean)
    .map((value, index) => (index === 0 ? `CRR: ${value}` : `RRR: ${value}`))
    .join("  ");

  const title =
    cleanText(match?.related_name) ||
    teams.map((team) => team.name).join(" vs ") ||
    cleanText(match?.key) ||
    "";

  const overBreak = isOverBreak(match, commentary);
  const topDisplay = overBreak
    ? ""
    : normalizeTopDisplayEvent(
        pickText(ball.event, ball.token, commentary?.primaryText, commentary?.primary),
      );
  const startDate =
    cleanText(match?.start_date?.iso) ||
    cleanText(match?.start_date?.str) ||
    cleanText(match?.start_date) ||
    "";

  return {
    matchId: meta.matchId || match?.key || "",
    matchDbId: meta.matchDbId || match?._id || "",
    title,
    status: match?.status || "unknown",
    startDate,
    teams,
    teamsLabel: teams.map((team) => team.name).join(" vs "),
    scoreHtml: formatTeamsScoreHtml(match, teams),
    inningScore: currentTeamBlock
      ? `${currentTeamBlock.name} ${currentTeamBlock.score}${currentTeamBlock.overs ? ` (${currentTeamBlock.overs})` : ""}`
      : "",
    over: cleanText(now.over_str || now.over || match?.powerplayOver),
    crr: cleanText(now.run_rate || now.current_run_rate || now.crr),
    rrr: cleanText(now.req_run_rate || now.rrr),
    rates,
    required: buildRequiredText(match),
    batsmen,
    batsmanNames,
    bowler,
    bowlerName,
    strikerName:
      cleanText(now.striker?.fullname) ||
      cleanText(now.striker?.name) ||
      "",
    ballEvent: overBreak ? "" : ball.event,
    ballToken: overBreak ? "" : ball.token,
    topDisplay,
    lastBall: overBreak ? "" : pickText(ball.token, ball.event, topDisplay),
    commentary: ball.text,
    announcement: cleanText(match?.announcement1),
    powerplay: cleanText(match?.powerplay),
    isOverBreak: overBreak,
    connected: Boolean(meta.connected),
    socketConnected: Boolean(meta.socketConnected),
    error: meta.error || "",
    lastUpdate: new Date().toISOString(),
  };
}

module.exports = {
  AUTH,
  API_BASE,
  cleanText,
  mergeMatchState,
  buildOverlayState,
  extractBallFromCommentary,
  normalizeTopDisplayEvent,
};
