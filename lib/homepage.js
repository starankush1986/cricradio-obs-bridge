const AUTH =
  "Basic Y3JpY2tldFJhZGlvOmNyaWNrZXRAJCUjUmFkaW8xMjM=";
const API_BASE = "https://server.cricradio.com.au/api/v2";
const HOME_URL = "https://cricradio.com/";
const MATCH_KEY_PATTERN =
  /"key":"([A-Za-z0-9_-]+_vs_[A-Za-z0-9_-]+_\d{4}-\d{2}-\d{2}_\d+)"/g;

async function fetchHomepageHtml() {
  const response = await fetch(HOME_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html",
    },
  });
  if (!response.ok) {
    throw new Error(`Homepage ${response.status}`);
  }
  return response.text();
}

function unescapeHomeHtml(html) {
  return html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function readJsonString(chunk, startIndex) {
  if (chunk[startIndex] !== '"') {
    return "";
  }
  let value = "";
  for (let i = startIndex + 1; i < chunk.length; i += 1) {
    const ch = chunk[i];
    if (ch === "\\") {
      value += chunk[i + 1] || "";
      i += 1;
      continue;
    }
    if (ch === '"') {
      return value;
    }
    value += ch;
  }
  return value;
}

function extractObjectAt(chunk, openBraceIndex) {
  if (chunk[openBraceIndex] !== "{") {
    return null;
  }

  let depth = 0;
  for (let i = openBraceIndex; i < chunk.length; i += 1) {
    const ch = chunk[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const raw = chunk.slice(openBraceIndex, i + 1);
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseMatchesFromHomeHtml(html) {
  const text = unescapeHomeHtml(html);
  const matches = new Map();
  let patternMatch;

  while ((patternMatch = MATCH_KEY_PATTERN.exec(text)) !== null) {
    const matchId = patternMatch[1];
    const keyToken = `"key":"${matchId}"`;
    const keyIndex = text.indexOf(keyToken, patternMatch.index);
    if (keyIndex < 0) {
      continue;
    }

    const openBraceIndex = text.lastIndexOf("{", keyIndex);
    const obj = extractObjectAt(text, openBraceIndex);
    if (!obj?.key || obj.key !== matchId) {
      continue;
    }

    if (obj.status === "completed") {
      continue;
    }

    matches.set(matchId, obj);
  }

  return [...matches.values()];
}

async function discoverMatchesFromHomepage() {
  const html = await fetchHomepageHtml();
  return parseMatchesFromHomeHtml(html).map((match) => ({
    matchId: match.key,
    status: match.status || "unknown",
    related_name: match.related_name || "",
    title: match.related_name || match.key,
    _id: match._id,
    teams: match.teams,
    now: match.now,
    settingObj: match.settingObj,
    lastCommentary: match.lastCommentary,
    start_date: match.start_date,
    msgs: match.msgs,
    format: match.format,
    key: match.key,
  }));
}

module.exports = {
  discoverMatchesFromHomepage,
  parseMatchesFromHomeHtml,
};
