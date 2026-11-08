// Domain rules: standings, player statistics and formatting.
// Everything here is derived from the stored competition data or from explicit
// settings stored on the competition row. Matches are entered by hand, so there
// is no fixture generation here.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { all, get } from "./db.mjs";

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

/** Render a stored UTC instant as wall-clock { date, time } in `tz`. */
export function localParts(iso, tz = "Europe/Warsaw") {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d),
    time: new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d),
  };
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
 * Compute the standings of one group from its finished group-stage games.
 * Pass `groupId` to scope to a single group; omit it to include every group
 * stage round (useful when the competition has no groups yet).
 * Ranking follows the stored competition settings: points, then goal
 * difference, goals scored and wins. The previous snapshot feeds position deltas.
 */
export function computeStandings(db, competitionId, { groupId = null, usePrevious = false } = {}) {
  const comp = get(db, "SELECT * FROM competition WHERE id = ?", competitionId);
  if (!comp) return [];
  const teamParams = [competitionId];
  let teamSql = `SELECT ct.id AS competition_team_id, t.id AS team_id, t.name AS team_name, t.slug AS team_slug,
            t.crest_url
       FROM competition_team ct JOIN team t ON t.id = ct.team_id
      WHERE ct.competition_id = ?`;
  if (groupId !== null) { teamSql += " AND ct.group_id = ?"; teamParams.push(groupId); }
  const teams = all(db, teamSql, ...teamParams);

  const gameParams = [competitionId];
  let gameSql = `SELECT g.id, g.game_date, g.score_home, g.score_away, g.score_home + g.score_away AS total,
            ht.competition_team_id AS home_ct, at.competition_team_id AS away_ct
       FROM game g
       JOIN round r ON r.id = g.round_id
       JOIN game_team ht ON ht.game_id = g.id AND ht.team_type = 'HOME'
       JOIN game_team at ON at.game_id = g.id AND at.team_type = 'AWAY'
      WHERE r.competition_id = ? AND r.stage = 'GROUP' AND g.status = 'FINISHED'`;
  if (groupId !== null) { gameSql += " AND r.group_id = ?"; gameParams.push(groupId); }
  gameSql += " ORDER BY g.game_date ASC, g.id ASC";
  const games = all(db, gameSql, ...gameParams);

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

  const previous = computeStandings(db, competitionId, { groupId, usePrevious: true });
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

/* ----------------------------------------------------------------- helpers */

const pad = (n) => String(n).padStart(2, "0");

/* ---------------------------------------------------------------- fixtures */

/** Deterministic PRNG (mulberry32) so fixture draws are reproducible in tests. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, random = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Round-robin pairings: every team faces every other team once per leg.
 * With `random` given, the team order and the home/away side of each pairing
 * are shuffled. `doubleRound` adds a mirrored second leg.
 * Returns an array of rounds; each round is an array of [home, away] pairs.
 */
export function roundRobin(ids, { doubleRound = false, random = null } = {}) {
  const teams = random ? shuffle(ids, random) : ids.slice();
  if (teams.length % 2 === 1) teams.push(null);
  const n = teams.length;
  if (n < 2) return [];
  const arr = teams.slice();
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a === null || b === null) continue;
      pairs.push(random && random() < 0.5 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  if (doubleRound) {
    return [...rounds, ...rounds.map((rd) => rd.map(([a, b]) => [b, a]))];
  }
  return rounds;
}

/**
 * Automatic time-slot planner. Assigns date, time and pitch to each game in
 * the given order so a team never exceeds `maxPerDayPerTeam` games on the same
 * day and a pitch never hosts two games in the same slot.
 *
 * games: [{ id, home, away }] — team identifiers (any comparable value).
 * busyTeams / busyPitches: occupancy from games scheduled beforehand:
 *   busyTeams: Map(teamId -> Map("YYYY-MM-DD" -> count))
 *   busyPitches: Map(pitchId -> Set("YYYY-MM-DD HH:MM"))
 * Returns { assignments: [{ id, date, time, pitchId }], unscheduled: [id] }.
 */
export function planSchedule(games, {
  startDate, fromTime = "18:00", toTime = "23:00", slotMinutes = 60,
  pitchIds = [], busyTeams = new Map(), busyPitches = new Map(),
  maxPerDayPerTeam = 1, maxDays = 366,
} = {}) {
  const [fh, fm] = String(fromTime).split(":").map(Number);
  const [th, tm] = String(toTime).split(":").map(Number);
  const firstMin = fh * 60 + fm;
  const lastStart = th * 60 + tm - slotMinutes;
  if (!startDate || lastStart < firstMin) {
    return { assignments: [], unscheduled: games.map((g) => g.id) };
  }
  const teamDays = new Map();
  const pitchSlots = new Map();
  const countOf = (t, day) => (busyTeams.get(t)?.get(day) || 0) + (teamDays.get(t)?.get(day) || 0);
  const pitchTaken = (p, key) => busyPitches.get(p)?.has(key) || pitchSlots.get(p)?.has(key);

  const assignments = [];
  const unscheduled = [];

  for (const game of games) {
    // Each game scans from the first slot so parallel pitches fill the same
    // hour before the planner moves on to the next one.
    const cursor = new Date(`${startDate}T00:00:00Z`);
    let date = startDate;
    let minutes = firstMin;
    let placed = false;
    for (let guard = 0; guard < maxDays * 40 && !placed; guard++) {
      const key = `${date} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
      if (countOf(game.home, date) < maxPerDayPerTeam && countOf(game.away, date) < maxPerDayPerTeam) {
        let pitchId = null;
        for (const p of pitchIds) {
          if (!pitchTaken(p, key)) { pitchId = p; break; }
        }
        if (pitchIds.length === 0 || pitchId !== null) {
          assignments.push({ id: game.id, date, time: key.slice(11), pitchId });
          for (const t of [game.home, game.away]) {
            if (!teamDays.has(t)) teamDays.set(t, new Map());
            const m = teamDays.get(t);
            m.set(date, (m.get(date) || 0) + 1);
          }
          if (pitchId !== null) {
            if (!pitchSlots.has(pitchId)) pitchSlots.set(pitchId, new Set());
            pitchSlots.get(pitchId).add(key);
          }
          placed = true;
        }
      }
      minutes += slotMinutes;
      if (minutes > lastStart) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        date = cursor.toISOString().slice(0, 10);
        minutes = firstMin;
      }
    }
    if (!placed) unscheduled.push(game.id);
  }
  return { assignments, unscheduled };
}

/* ---------------------------------------------------------------- playoffs */

/**
 * Rank every group-stage team with an adjusted record so mixed-size groups
 * compare fairly (e.g. a 3-team group next to a 4-team group): for the teams
 * of a larger group only the games against the top `minSize` finishers count,
 * the classic "discard results vs the bottom side" rule.
 * Returns every team ordered by adjusted points, goal difference, goals and
 * wins, flagged with `groupWinner` / `qualified` (winners + best runner-up).
 */
export function computeGroupSeeds(db, competitionId) {
  const comp = get(db, "SELECT * FROM competition WHERE id = ?", competitionId);
  if (!comp) return [];
  const groups = all(db,
    "SELECT * FROM competition_group WHERE competition_id = ? ORDER BY ordering, id", competitionId);

  // No groups: the whole group stage is one table; the top two advance.
  if (groups.length === 0) {
    const rows = computeStandings(db, competitionId);
    return rows.map((r) => ({
      competition_team_id: r.competition_team_id, team_id: r.team_id, team_name: r.team_name,
      group_id: null, group_name: null, place: r.place,
      points: r.points, goals_diff: r.goals_diff, goals_scored: r.goals_scored, games_won: r.games_won,
      groupWinner: r.place === 1, qualified: r.place <= 2,
    }));
  }

  const tables = groups
    .map((g) => ({ group: g, rows: computeStandings(db, competitionId, { groupId: g.id }) }))
    .filter((t) => t.rows.length > 0);
  if (tables.length === 0) return [];
  const minSize = Math.min(...tables.map((t) => t.rows.length));

  // Adjusted record per team from its finished group games that count.
  const seeds = [];
  for (const { group, rows } of tables) {
    const keep = new Set(rows.filter((r) => r.place <= minSize).map((r) => r.competition_team_id));
    const games = all(db,
      `SELECT g.score_home, g.score_away,
              ht.competition_team_id AS home_ct, at.competition_team_id AS away_ct
         FROM game g JOIN round r ON r.id = g.round_id
         JOIN game_team ht ON ht.game_id = g.id AND ht.team_type = 'HOME'
         JOIN game_team at ON at.game_id = g.id AND at.team_type = 'AWAY'
        WHERE r.competition_id = ? AND r.stage = 'GROUP' AND r.group_id = ?
          AND g.status = 'FINISHED' AND g.score_home IS NOT NULL AND g.score_away IS NOT NULL`,
      competitionId, group.id);
    const rec = new Map(rows.map((r) => [r.competition_team_id, { points: 0, gf: 0, ga: 0, wins: 0 }]));
    for (const g of games) {
      if (!keep.has(g.home_ct) || !keep.has(g.away_ct)) continue;
      for (const [ct, gf, ga] of [[g.home_ct, g.score_home, g.score_away], [g.away_ct, g.score_away, g.score_home]]) {
        const r = rec.get(ct);
        r.gf += gf; r.ga += ga;
        if (gf > ga) { r.wins += 1; r.points += comp.points_win; }
        else if (gf === ga) { r.points += comp.points_draw; }
        else { r.points += comp.points_lose; }
      }
    }
    for (const row of rows) {
      const a = rec.get(row.competition_team_id);
      seeds.push({
        competition_team_id: row.competition_team_id, team_id: row.team_id, team_name: row.team_name,
        group_id: group.id, group_name: group.name, place: row.place,
        points: a.points, goals_diff: a.gf - a.ga, goals_scored: a.gf, games_won: a.wins,
        groupWinner: row.place === 1, qualified: false,
      });
    }
  }

  const byRecord = (a, b) =>
    b.points - a.points || b.goals_diff - a.goals_diff || b.goals_scored - a.goals_scored ||
    b.games_won - a.games_won || a.team_name.localeCompare(b.team_name);
  const runnersUp = seeds.filter((s) => s.place === 2).sort(byRecord);
  const bestRunnerUp = runnersUp[0]?.competition_team_id ?? null;
  for (const s of seeds) {
    s.qualified = s.groupWinner || s.competition_team_id === bestRunnerUp;
    s.bestRunnerUp = s.competition_team_id === bestRunnerUp;
  }
  return seeds.sort(byRecord).map((s, i) => ({ ...s, seed: i + 1 }));
}

/** Qualified seeds in bracket order: group winners plus the best runner-up. */
export function computeQualifiers(db, competitionId) {
  return computeGroupSeeds(db, competitionId).filter((s) => s.qualified);
}

/**
 * Best-vs-worst bracket pairing for a list of ordered seeds (first = best).
 * With an odd number of teams the top seed advances with a bye.
 * Returns { pairs: [[seedA, seedB], ...], bye } using the seed objects given.
 */
export function pairSeeds(seeds) {
  const ids = seeds.slice();
  let bye = null;
  if (ids.length % 2 === 1) bye = ids.shift();
  const pairs = [];
  for (let i = 0, j = ids.length - 1; i < j; i++, j--) pairs.push([ids[i], ids[j]]);
  return { pairs, bye };
}

export function competitionBySlug(db, slug) {
  return get(db, "SELECT * FROM competition WHERE slug = ?", slug);
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

export { pad };
