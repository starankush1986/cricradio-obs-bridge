const SCOREBOARD_BASE = "https://cricradio.com/scoreboard";

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

function unescapeHtmlJson(html) {
  return html.replace(/\\"/g, '"');
}

function extractObjectAt(text, openIndex) {
  if (text[openIndex] !== "{") {
    return null;
  }

  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(openIndex, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
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

function computeRunRate(runs, overs) {
  const oversDecimal = parseOversDecimal(overs);
  if (!oversDecimal) {
    return "";
  }
  return (Number(runs) / oversDecimal).toFixed(2);
}

function extractMsgsObject(text) {
  const marker = '"msgs":{';
  const idx = text.indexOf(marker);
  if (idx < 0) {
    return null;
  }
  return extractObjectAt(text, idx + '"msgs":'.length);
}

function extractNowObject(text) {
  const marker = '"now":{';
  const idx = text.indexOf(marker);
  if (idx < 0) {
    return null;
  }
  return extractObjectAt(text, idx + '"now":'.length);
}

function extractSettingObject(text) {
  const marker = '"settingObj":{';
  const idx = text.indexOf(marker);
  if (idx < 0) {
    return null;
  }
  return extractObjectAt(text, idx + '"settingObj":'.length);
}

function extractInningBlock(text, teamKey, inning) {
  const marker = `"${teamKey}_${inning}":{`;
  const idx = text.indexOf(marker);
  if (idx < 0) {
    return null;
  }
  return extractObjectAt(text, idx + marker.length - 1);
}

async function fetchScoreboardLivePatch(matchId) {
  const key = cleanText(matchId);
  if (!key) {
    return null;
  }

  const response = await fetch(`${SCOREBOARD_BASE}/${encodeURIComponent(key)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`Scoreboard page ${response.status}`);
  }

  const text = unescapeHtmlJson(await response.text());
  const now = extractNowObject(text);
  if (!now) {
    return null;
  }

  const msgs = extractMsgsObject(text) || {};
  const setting = extractSettingObject(text) || {};
  const teamKey = cleanText(setting.currentTeam) || "a";
  const inning = Number(setting.currentInning || now.innings || 1);
  const inningBlock = extractInningBlock(text, teamKey, inning);

  const crr = computeRunRate(inningBlock?.runs, inningBlock?.overs);
  const rrr = cleanText(now.req_run_rate || now.rrr || "");

  return {
    msgs,
    now: {
      ...now,
      crr,
      run_rate: crr,
      current_run_rate: crr,
      rrr,
      req_run_rate: rrr,
    },
    settingObj: setting,
  };
}

module.exports = {
  fetchScoreboardLivePatch,
  computeRunRate,
  extractNowObject,
};
