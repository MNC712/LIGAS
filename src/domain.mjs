// Domain rules: standings, player statistics, schedule generation, formatting.
// Everything here is derived from the seeded public data or from explicit
// settings stored on the competition row.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { all, get, run } from "./db.mjs";

/* ------------------------------------------------------------------ format */

export function fmtDate(iso, tz = "Europe/Warsaw") {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
}

export function fmtTime(iso, tz = "Europe/Warsaw") {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

export function fmtDateTime(iso, tz = "Europe/Warsaw") {
  if (!iso) return "";
  return `${fmtDate(iso, tz)}, ${fmtTime(iso, tz)}`;
}

export function fmtDay(iso, tz = "Europe/Warsaw") {
  if (!iso) return "";
  return new Intl.DateTimeFormat("es-ES", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
}

export function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const value = {};
  for (const part of parts) if (part.type !== "literal") value[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(value.year), Number(value.month) - 1, Number(value.day),
    Number(value.hour) % 24, Number(value.minute), Number(value.second)
  );
  return asUtc - date.getTime();
}

/**
 * Convert a wall-clock date and time in `timeZone` to a UTC instant.
 * Used when a league administrator enters a local kick-off time.
 */
export function localDateTimeToUtc(dateStr, timeStr, timeZone = "Europe/Warsaw") {
  const [year, month, day] = String(dateStr).split("-").map(Number);
  const [hours, minutes] = String(timeStr).split(":").map(Number);
  if (![year, month, day, hours, minutes].every(Number.isFinite)) {
    throw new Error(`Invalid date or time: ${dateStr} ${timeStr}`);
  }
  const wallClock = Date.UTC(year, month - 1, day, hours, minutes, 0);
  // Two passes settle dates that fall on a DST transition.
  let instant = wallClock - timeZoneOffsetMs(new Date(wallClock), timeZone);
  instant = wallClock - timeZoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

export function slugify(input) {
  return String(input || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l").replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* -------------------------------------------------------------------- auth */

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, salt, expected) {
  const actual = scryptSync(password, salt, 64);
  const want = Buffer.from(expected, "hex");
  return actual.length === want.length && timingSafeEqual(actual, want);
}

/* --------------------------------------------------------------- standings */

const outcomeFor = (gf, ga) => (gf > ga ? "W" : gf === ga ? "D" : "L");

/**
 * Compute standings for a league competition from finished games.
 * Ranking follows the stored competition settings: points, then goal
 * difference, goals scored and wins. `previous` is used for position deltas.
 */
export function computeStandings(db, competitionId, { usePrevious = false } = {}) {
  const comp = get(db, "SELECT * FROM competition WHERE id = ?", competitionId);
  if (!comp) return [];
  const teams = all(
    db,
    `SELECT ct.id AS competition_team_id, t.id AS team_id, t.name AS team_name, t.slug AS team_slug,
            t.crest_url
       FROM competition_team ct JOIN team t ON t.id = ct.team_id
      WHERE ct.competition_id = ?`,
    competitionId
  );
  const games = all(
    db,
    `SELECT g.id, g.game_date, g.score_home, g.score_away, g.score_home + g.score_away AS total,
            ht.competition_team_id AS home_ct, at.competition_team_id AS away_ct
       FROM game g
       JOIN round r ON r.id = g.round_id
       JOIN game_team ht ON ht.game_id = g.id AND ht.team_type = 'HOME'
       JOIN game_team at ON at.game_id = g.id AND at.team_type = 'AWAY'
      WHERE r.competition_id = ? AND g.status = 'FINISHED'
      ORDER BY g.game_date ASC, g.id ASC`,
    competitionId
  );

  const rows = new Map();
  for (const t of teams) {
    rows.set(t.competition_team_id, {
      competition_team_id: t.competition_team_id,
      team_id: t.team_id,
      team_name: t.team_name,
      team_slug: t.team_slug,
      crest_url: t.crest_url,
      points: 0, games_played: 0, games_won: 0, games_drawn: 0, games_lost: 0,
      goals_scored: 0, goals_conceded: 0, goals_diff: 0,
      form: [], history: [],
    });
  }

  const latest = games.length ? games[games.length - 1].game_date : null;
  for (const g of games) {
    if (usePrevious && latest && g.game_date === latest) continue;
    const home = rows.get(g.home_ct);
    const away = rows.get(g.away_ct);
    if (!home || !away) continue;
    // A finished game with no recorded score still counts as played for both
    // sides (observed on the public standings), but awards no result.
    if (g.score_home === null || g.score_away === null) {
      home.games_played += 1;
      away.games_played += 1;
      continue;
    }
    const hs = g.score_home;
    const as = g.score_away;
    for (const [team, gf, ga] of [[home, hs, as], [away, as, hs]]) {
      team.games_played += 1;
      team.goals_scored += gf;
      team.goals_conceded += ga;
      const out = outcomeFor(gf, ga);
      if (out === "W") { team.games_won += 1; team.points += comp.points_win; }
      else if (out === "D") { team.games_drawn += 1; team.points += comp.points_draw; }
      else { team.games_lost += 1; team.points += comp.points_lose; }
      team.history.push({ game_date: g.game_date, out, gf, ga });
    }
  }

  const list = [...rows.values()];
  for (const r of list) {
    r.goals_diff = r.goals_scored - r.goals_conceded;
    r.form = r.history
      .slice()
      .sort((a, b) => (a.game_date < b.game_date ? 1 : -1))
      .slice(0, 5)
      .map((h) => h.out);
  }

  const dir = (v) => (String(v).toUpperCase() === "ASC" ? -1 : 1);
  list.sort((a, b) =>
    dir(comp.ranking_points) * (b.points - a.points) ||
    dir(comp.ranking_goal_diff) * (b.goals_diff - a.goals_diff) ||
    dir(comp.ranking_goals_scored) * (b.goals_scored - a.goals_scored) ||
    dir(comp.ranking_wins) * (b.games_won - a.games_won) ||
    a.team_name.localeCompare(b.team_name)
  );
  list.forEach((r, i) => { r.place = i + 1; });

  if (usePrevious) return list;

  const previous = computeStandings(db, competitionId, { usePrevious: true });
  const prevPlace = new Map(previous.map((p) => [p.competition_team_id, p.place]));
  for (const r of list) {
    const before = prevPlace.get(r.competition_team_id);
    r.position_delta = before ? before - r.place : 0;
  }
  return list;
}

/* ---------------------------------------------------------------- players */

export function computePlayerStats(db, competitionId) {
  const base = all(
    db,
    `SELECT cp.id AS competition_player_id, cp.squad_number, cp.competition_team_id,
            p.id AS player_id, p.slug, p.first_name, p.last_name, p.avatar_url, p.date_of_birth,
            t.name AS team_name, t.slug AS team_slug, t.crest_url,
            COALESCE(b.games,0) AS b_games,
            COALESCE(b.goals,0) AS b_goals, COALESCE(b.assists,0) AS b_assists,
            COALESCE(b.mvp,0) AS b_mvp, COALESCE(b.yellow,0) AS b_yellow,
            COALESCE(b.red,0) AS b_red, COALESCE(b.conceded,0) AS b_conceded
       FROM competition_player cp
       JOIN player p ON p.id = cp.player_id
       JOIN competition_team ct ON ct.id = cp.competition_team_id
       JOIN team t ON t.id = ct.team_id
       LEFT JOIN player_stat_base b ON b.competition_player_id = cp.id
      WHERE cp.competition_id = ?`,
    competitionId
  );
  const counts = all(
    db,
    `SELECT e.game_player_id, et.system_name, COUNT(*) AS n,
            SUM(CASE WHEN e.for_opposite_team = 1 THEN 1 ELSE 0 END) AS own
       FROM event e
       JOIN event_type et ON et.id = e.event_type_id
       JOIN game g ON g.id = e.game_id
       JOIN round r ON r.id = g.round_id
      WHERE r.competition_id = ?
      GROUP BY e.game_player_id, et.system_name`,
    competitionId
  );
  const byGp = new Map();
  for (const c of counts) {
    if (!byGp.has(c.game_player_id)) byGp.set(c.game_player_id, {});
    byGp.get(c.game_player_id)[c.system_name] = c.n;
  }
  const gpRows = all(
    db,
    `SELECT gp.id, gp.competition_player_id FROM game_player gp
       JOIN game g ON g.id = gp.game_id JOIN round r ON r.id = g.round_id
      WHERE r.competition_id = ?`,
    competitionId
  );
  const gpToCp = new Map(gpRows.map((r) => [r.id, r.competition_player_id]));
  const evByCp = new Map();
  for (const [gpid, kinds] of byGp) {
    const cp = gpToCp.get(gpid);
    if (!cp) continue;
    const bucket = evByCp.get(cp) || {};
    for (const [k, n] of Object.entries(kinds)) bucket[k] = (bucket[k] || 0) + n;
    evByCp.set(cp, bucket);
  }

  return base.map((r) => {
    const ev = evByCp.get(r.competition_player_id) || {};
    return {
      competition_player_id: r.competition_player_id,
      player_id: r.player_id,
      slug: r.slug,
      full_name: `${r.first_name} ${r.last_name}`.trim(),
      first_name: r.first_name,
      last_name: r.last_name,
      avatar_url: r.avatar_url,
      date_of_birth: r.date_of_birth,
      squad_number: r.squad_number,
      competition_team_id: r.competition_team_id,
      team_name: r.team_name,
      team_slug: r.team_slug,
      crest_url: r.crest_url,
      games_played: r.b_games,
      goals_scored: r.b_goals + (ev.goal || 0),
      assists: r.b_assists + (ev.assist || 0),
      mvp: r.b_mvp + (ev.mvp || 0),
      yellow_cards: r.b_yellow + (ev.yellow_card || 0),
      red_cards: r.b_red + (ev.red_card || 0),
      conceded: r.b_conceded,
    };
  });
}

/** Games played per competition player, derived from the game_player rows. */
export function gamesPlayedByPlayer(db, competitionId) {
  const rows = all(
    db,
    `SELECT gp.competition_player_id, COUNT(*) AS n
       FROM game_player gp
       JOIN game g ON g.id = gp.game_id
       JOIN round r ON r.id = g.round_id
      WHERE r.competition_id = ? AND g.status = 'FINISHED'
      GROUP BY gp.competition_player_id`,
    competitionId
  );
  return new Map(rows.map((r) => [r.competition_player_id, r.n]));
}

/* ---------------------------------------------------------------- fixtures */

/** Round-robin pairings using the circle method. Returns arrays of [home, away]. */
export function roundRobin(ids, { doubleRound = true } = {}) {
  const teams = ids.slice();
  if (teams.length % 2 === 1) teams.push(null);
  const n = teams.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i];
      const b = teams[n - 1 - i];
      if (a && b) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    teams.splice(1, 0, teams.pop());
  }
  if (doubleRound) {
    const second = rounds.map((pairs) => pairs.map(([a, b]) => [b, a]));
    rounds.push(...second);
  }
  return rounds;
}

const pad = (n) => String(n).padStart(2, "0");

/**
 * Create rounds and games for a league competition.
 * Dates are weekly on `weekday` (0=Sunday) starting at startDate, using the
 * supplied kickoff times in order.
 */
export function generateSchedule(db, competitionId, opts) {
  const {
    startDate, weekday = 6, times = ["18:00"], pitchId = null,
    doubleRound = true, startRoundNumber = 1, timeZone = "Europe/Warsaw",
  } = opts;
  const teams = all(
    db,
    "SELECT id FROM competition_team WHERE competition_id = ? ORDER BY id",
    competitionId
  ).map((t) => t.id);
  if (teams.length < 2) throw new Error("At least two teams are required");
  const rounds = roundRobin(teams, { doubleRound });
  const created = [];
  let cursor = new Date(`${startDate}T12:00:00Z`);
  while (cursor.getUTCDay() !== Number(weekday)) cursor.setUTCDate(cursor.getUTCDate() + 1);

  rounds.forEach((pairs, index) => {
    const roundName = roundRobinName(startRoundNumber + index);
    const roundId = Number(
      run(db, "INSERT INTO round (competition_id, name) VALUES (?, ?)", competitionId, roundName).lastInsertRowid
    );
    created.push({ roundId, roundName, games: [] });
    pairs.forEach(([home, away], matchIndex) => {
      const time = times[matchIndex % times.length] || "18:00";
      const date = localDateTimeToUtc(isoDate(cursor), time, timeZone);
      const gameId = Number(
        run(
          db,
          "INSERT INTO game (round_id, pitch_id, game_date, status) VALUES (?, ?, ?, 'NOT_STARTED')",
          roundId, pitchId, date.toISOString()
        ).lastInsertRowid
      );
      run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?, ?, 'HOME')", gameId, home);
      run(db, "INSERT INTO game_team (game_id, competition_team_id, team_type) VALUES (?, ?, 'AWAY')", gameId, away);
      created[created.length - 1].games.push(gameId);
    });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  });
  return created;
}

/* ----------------------------------------------------------------- helpers */

export function competitionBySlugs(db, leagueSlug, seasonSlug) {
  return get(
    db,
    `SELECT c.* FROM competition c
       JOIN league l ON l.id = c.league_id
       JOIN season s ON s.id = c.season_id
      WHERE l.slug = ? AND s.slug = ? AND c.type = 'LEAGUE'`,
    leagueSlug, seasonSlug
  );
}

export function theme(db) {
  const org = get(db, "SELECT * FROM organization LIMIT 1") || {};
  return {
    primary: org.primary_color || "#006fff",
    secondary: org.secondary_color || "#0500ff",
    background: org.background_color || "#ffffff",
    accent: org.background_accent_color || "#e1e9f4",
    text: org.text_color || "#2c3034",
    textSecondary: org.text_secondary_color || "#505c66",
    timezone: org.timezone || "Europe/Warsaw",
  };
}

export function statusLabel(status) {
  return {
    NOT_STARTED: "Pendiente", STARTED: "En juego", BREAK: "Descanso",
    FINISHED: "Finalizado", CANCELED: "Cancelado",
  }[status] || status;
}

export function roundRobinName(index) {
  return `Kolejka ${index}`;
}

export { pad };
