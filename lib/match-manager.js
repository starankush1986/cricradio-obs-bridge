const {
  AUTH,
  API_BASE,
  cleanText,
  mergeMatchState,
  buildOverlayState,
} = require("./state");
const { fetchScoreboardLivePatch } = require("./scoreboard-page");

class MatchManager {
  constructor() {
    this.matches = new Map(); // matchKey -> { raw, dbId, state, handlersBound }
    this.activeMatchId = "";
    this.socket = null;
    this.onChange = null;
    this.joinedRooms = new Set();
    this.subscriptions = new Map(); // dbId -> unsubscribe
  }

  setSocket(socket) {
    this.socket = socket;
  }

  setOnChange(callback) {
    this.onChange = callback;
  }

  getMatchList() {
    return [...this.matches.values()]
      .map((entry) => entry.state)
      .sort((a, b) => {
        const rank = (status) =>
          status === "started" ? 0 : status === "notstarted" ? 1 : 2;
        const diff = rank(a.status) - rank(b.status);
        if (diff !== 0) {
          return diff;
        }
        return (a.title || a.matchId).localeCompare(b.title || b.matchId);
      });
  }

  getCategorizedLists() {
    const all = this.getMatchList();
    return {
      live: all
        .filter((match) => match.status === "started")
        .map((match) => this.summarizeMatch(match)),
      upcoming: all
        .filter((match) => match.status === "notstarted")
        .map((match) => this.summarizeMatch(match)),
    };
  }

  summarizeMatch(match) {
    return {
      matchId: match.matchId,
      title: match.title || match.teamsLabel || match.matchId,
      status: match.status,
      inningScore: match.inningScore || "",
      teamsLabel: match.teamsLabel || "",
      startDate: match.startDate || "",
    };
  }

  getBoardPayload(viewMatchId = "") {
    const requestedId = cleanText(viewMatchId) || this.activeMatchId;
    const state = this.getState(requestedId);
    const { live, upcoming } = this.getCategorizedLists();

    return {
      activeMatchId: this.activeMatchId,
      viewMatchId: state.matchId || requestedId,
      state,
      live,
      upcoming,
      socketConnected: Boolean(this.socket?.connected),
    };
  }

  getActiveState() {
    const active =
      this.matches.get(this.activeMatchId) ||
      [...this.matches.values()].find((entry) => entry.state.status === "started") ||
      this.matches.values().next().value;

    if (!active) {
      return buildOverlayState({}, {
        matchId: this.activeMatchId,
        connected: true,
        socketConnected: Boolean(this.socket?.connected),
      });
    }

    return active.state;
  }

  getState(matchId) {
    if (!matchId) {
      return this.getActiveState();
    }
    return (
      this.matches.get(matchId)?.state ||
      buildOverlayState({}, { matchId, connected: true })
    );
  }

  setActiveMatchId(matchId) {
    if (!matchId) {
      return false;
    }
    if (!this.matches.has(matchId)) {
      return false;
    }
    this.activeMatchId = matchId;
    this.notify();
    return true;
  }

  async selectMatch(matchId) {
    const key = cleanText(matchId);
    if (!key) {
      return false;
    }

    if (!this.matches.has(key)) {
      await this.ensureMatch(key);
    }

    this.activeMatchId = key;
    await this.refreshLiveDetails(key);
    this.notify();
    return true;
  }

  notify() {
    if (this.onChange) {
      this.onChange();
    }
  }

  async apiGet(pathname) {
    const response = await fetch(`${API_BASE}${pathname}`, {
      headers: {
        Authorization: AUTH,
        Accept: "application/json",
        "User-Agent": "CricRadio-OBS-Bridge/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`API ${response.status} for ${pathname}`);
    }

    const json = await response.json();
    return json?.responseData?.result ?? json?.responseData?.data ?? json;
  }

  async ensureMatch(matchKey, seed = {}) {
    if (!matchKey) {
      return null;
    }

    let entry = this.matches.get(matchKey);
    if (!entry) {
      entry = {
        raw: { key: matchKey, ...seed },
        dbId: String(seed._id || ""),
        state: buildOverlayState({ key: matchKey, ...seed }, { matchId: matchKey }),
        handlersBound: false,
      };
      this.matches.set(matchKey, entry);
    }

    try {
      const [miniCard, scoreCard] = await Promise.all([
        this.apiGet(`/match/mini-match-card?matchId=${encodeURIComponent(matchKey)}`),
        this.apiGet(
          `/match/scoreCard?matchId=${encodeURIComponent(matchKey)}&inningsNumber=1&battingTeam=a`,
        ),
      ]);

      const dbId = String(
        seed._id || scoreCard?._id || miniCard?._id || entry.dbId || "",
      );
      entry.dbId = dbId;
      entry.raw = mergeMatchState(entry.raw, {
        ...miniCard,
        ...scoreCard,
        ...seed,
        key: matchKey,
        _id: dbId || seed._id,
        status: seed.status || miniCard?.status || scoreCard?.status,
        related_name:
          seed.related_name || miniCard?.related_name || scoreCard?.related_name,
      });
      entry.state = buildOverlayState(entry.raw, {
        matchId: matchKey,
        matchDbId: dbId,
        connected: true,
        socketConnected: Boolean(this.socket?.connected),
      });

      if (dbId) {
        this.subscribeMatch(dbId, matchKey);
      }
    } catch (error) {
      entry.state = buildOverlayState(entry.raw, {
        matchId: matchKey,
        matchDbId: entry.dbId,
        connected: false,
        socketConnected: Boolean(this.socket?.connected),
        error: error.message,
      });
    }

    if (!this.activeMatchId && entry.state.status === "started") {
      this.activeMatchId = matchKey;
    }

    if (entry.state.status === "started") {
      await this.refreshLiveDetails(matchKey);
    }

    this.notify();
    return entry;
  }

  async refreshLiveDetails(matchKey) {
    const key = cleanText(matchKey);
    const entry = this.matches.get(key);
    if (!entry || entry.state.status !== "started") {
      return;
    }

    try {
      const patch = await fetchScoreboardLivePatch(key);
      if (!patch?.now) {
        return;
      }

      entry.raw = mergeMatchState(entry.raw, patch);
      entry.state = buildOverlayState(entry.raw, {
        matchId: key,
        matchDbId: entry.dbId,
        connected: true,
        socketConnected: Boolean(this.socket?.connected),
      });
      this.notify();
    } catch (error) {
      console.error(`live details refresh failed for ${key}:`, error.message);
    }
  }

  async refreshLiveDetailsForStartedMatches() {
    const tasks = [...this.matches.entries()]
      .filter(([, entry]) => entry.state.status === "started")
      .map(([matchKey]) => this.refreshLiveDetails(matchKey));
    await Promise.all(tasks);
  }

  async refreshMatchListFromApi() {
    let count = 0;

    try {
      const list = await this.apiGet("/match/list");
      const items = Array.isArray(list) ? list : [];
      for (const item of items) {
        const key = cleanText(item?.key || item?.matchKey);
        if (key) {
          await this.ensureMatch(key, item);
          count += 1;
        }
      }
    } catch (error) {
      console.error("match/list refresh failed:", error.message);
    }

    try {
      const { discoverMatchesFromHomepage } = require("./homepage");
      const discovered = await discoverMatchesFromHomepage();
      for (const item of discovered) {
        const key = cleanText(item?.matchId);
        if (!key) {
          continue;
        }
        await this.ensureMatch(key, {
          key,
          _id: item._id,
          status: item.status,
          related_name: item.related_name || item.title,
          teams: item.teams,
          now: item.now,
          settingObj: item.settingObj,
          lastCommentary: item.lastCommentary,
          start_date: item.start_date,
          msgs: item.msgs,
          format: item.format,
        });
        count += 1;
      }
    } catch (error) {
      console.error("homepage discovery failed:", error.message);
    }

    await this.refreshLiveDetailsForStartedMatches();

    return count;
  }

  async watchMatches(matchIds = []) {
    for (const matchId of matchIds) {
      await this.ensureMatch(matchId);
    }
  }

  joinGlobalRoom() {
    if (!this.socket) {
      return;
    }
    const room = "global";
    if (!this.joinedRooms.has(room)) {
      this.socket.emit(room);
      this.joinedRooms.add(room);
    }
  }

  subscribeMatch(dbId, matchKey) {
    if (!this.socket || !dbId || this.subscriptions.has(dbId)) {
      return;
    }

    this.socket.emit("base", dbId);
    this.socket.emit("scoreCardWeb", dbId);

    const entry = this.matches.get(matchKey);
    if (entry) {
      entry.handlersBound = true;
    }

    const updateMatch = (patch) => {
      const key = cleanText(patch?.key || patch?.matchKey || matchKey);
      const target = this.matches.get(key);
      if (!target) {
        return;
      }
      target.raw = mergeMatchState(target.raw, { ...patch, key });
      target.state = buildOverlayState(target.raw, {
        matchId: key,
        matchDbId: target.dbId,
        connected: true,
        socketConnected: Boolean(this.socket?.connected),
      });
      this.notify();
    };

    const { decodeSocketPayload, unwrapSocketData } = require("./decode");

    const onMini = (payload) => {
      const data = unwrapSocketData(decodeSocketPayload(payload));
      if (!data) {
        return;
      }
      if (data.key && data.key !== matchKey) {
        return;
      }
      updateMatch(data);
    };

    const onCommentary = (payload) => {
      const data = unwrapSocketData(decodeSocketPayload(payload));
      if (!data) {
        return;
      }
      updateMatch({
        lastCommentary: {
          primaryText: data.primaryText ?? data.primary,
          secondaryText: data.secondaryText ?? data.secondary,
          tertiaryText: data.tertiaryText ?? data.tertiary,
          isDone: data.isDone,
        },
      });
    };

    const onStatus = (payload) => {
      const data = unwrapSocketData(decodeSocketPayload(payload));
      if (data) {
        updateMatch(data);
      }
    };

    const events = [
      [`match:${dbId}:match-mini-c-e`, onMini],
      [`match:${dbId}:homeCommentary-c-e`, onCommentary],
      [`match:${dbId}:match-status-change-c-e`, onStatus],
    ];

    for (const [eventName, handler] of events) {
      this.socket.on(eventName, handler);
    }

    this.subscriptions.set(dbId, () => {
      for (const [eventName, handler] of events) {
        this.socket?.off(eventName, handler);
      }
    });
  }

  handleMatchListPatch(payload) {
    const { decodeSocketPayload, unwrapSocketData } = require("./decode");
    const data = unwrapSocketData(decodeSocketPayload(payload));
    if (!data) {
      return;
    }

    const key = cleanText(data.key || data.matchKey);
    if (!key) {
      return;
    }

    const existing = this.matches.get(key);
    if (existing) {
      existing.raw = mergeMatchState(existing.raw, data);
      existing.state = buildOverlayState(existing.raw, {
        matchId: key,
        matchDbId: existing.dbId,
        connected: true,
        socketConnected: Boolean(this.socket?.connected),
      });
      if (data._id && !existing.dbId) {
        existing.dbId = String(data._id);
        this.subscribeMatch(existing.dbId, key);
      }
      this.notify();
      return;
    }

    this.ensureMatch(key, data);
  }

  handleGlobalStatusChange(payload) {
    const { decodeSocketPayload, unwrapSocketData } = require("./decode");
    const data = unwrapSocketData(decodeSocketPayload(payload));
    if (!data?.status) {
      return;
    }

    const key = cleanText(data.matchKey || data.key);
    const entry =
      (key && this.matches.get(key)) ||
      [...this.matches.values()].find(
        (item) => item.dbId && String(item.dbId) === String(data._id),
      );

    if (!entry) {
      if (key) {
        this.ensureMatch(key, data);
      }
      return;
    }

    entry.raw = mergeMatchState(entry.raw, data);
    entry.state = buildOverlayState(entry.raw, {
      matchId: entry.state.matchId,
      matchDbId: entry.dbId,
      connected: true,
      socketConnected: Boolean(this.socket?.connected),
    });

    if (data.status === "started" && !this.activeMatchId) {
      this.activeMatchId = entry.state.matchId;
    }

    this.notify();
  }

  bindGlobalSocketHandlers() {
    if (!this.socket) {
      return;
    }

    this.socket.on("match-list-c-e", (payload) => {
      this.handleMatchListPatch(payload);
    });

    this.socket.on("match-status-change-c-e", (payload) => {
      this.handleGlobalStatusChange(payload);
    });

    this.socket.on("match-powerplay-c-e", (payload) => {
      const { decodeSocketPayload, unwrapSocketData } = require("./decode");
      const data = unwrapSocketData(decodeSocketPayload(payload));
      if (!data?._id) {
        return;
      }
      const entry = [...this.matches.values()].find(
        (item) => String(item.dbId) === String(data._id),
      );
      if (!entry) {
        return;
      }
      entry.raw = mergeMatchState(entry.raw, {
        powerplay: data.powerplay || data.powerplay_str,
        powerplayOver: data.powerplayOver,
      });
      entry.state = buildOverlayState(entry.raw, {
        matchId: entry.state.matchId,
        matchDbId: entry.dbId,
        connected: true,
        socketConnected: Boolean(this.socket?.connected),
      });
      this.notify();
    });
  }

  onSocketConnect() {
    this.joinedRooms.clear();

    for (const unsubscribe of this.subscriptions.values()) {
      unsubscribe();
    }
    this.subscriptions.clear();

    for (const entry of this.matches.values()) {
      entry.handlersBound = false;
    }

    this.joinGlobalRoom();

    for (const [matchKey, entry] of this.matches.entries()) {
      if (entry.dbId) {
        this.subscribeMatch(entry.dbId, matchKey);
      }
    }

    this.notify();
  }
}

module.exports = { MatchManager };
