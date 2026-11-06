// HTTP application: public league site, admin console and referee app.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, extname, normalize } from "node:path";
import { openDb, all, get, run, ROOT } from "./db.mjs";
import {
  theme, fmtDate, verifyPassword, generateSchedule, statusLabel,
  computeStandings, computePlayerStats, slugify,
} from "./domain.mjs";
import * as repo from "./repo.mjs";
import * as views from "./public-views.mjs";
import * as admin from "./admin-views.mjs";
import { html } from "./render.mjs";

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "127.0.0.1";
const db = openDb();

/* ------------------------------------------------------------------ utils */

const MIME = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json",
};

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie || "").flm_session;
  if (!token) return null;
  return get(
    db,
    `SELECT u.* FROM session s JOIN user u ON u.id = s.user_id WHERE s.token = ?`,
    token
  ) || null;
}

function setSession(res, userId) {
  const token = randomBytes(24).toString("hex");
  run(db, "INSERT INTO session (token, user_id, created_at) VALUES (?,?,?)", token, userId, new Date().toISOString());
  res.setHeader("Set-Cookie", `flm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function clearSession(req, res) {
  const token = parseCookies(req.headers.cookie || "").flm_session;
  if (token) run(db, "DELETE FROM session WHERE token = ?", token);
  res.setHeader("Set-Cookie", "flm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function sendHtml(res, content, status = 200) {
  const buffer = Buffer.from(String(content), "utf8");
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-length": buffer.length, "x-content-type-options": "nosniff" });
  res.end(buffer);
}

function redirect(res, location, status = 303) {
  res.writeHead(status, { location });
  res.end();
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  const type = req.headers["content-type"] || "";
  if (type.includes("application/json")) {
    try { return JSON.parse(rawBody || "{}"); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(rawBody));
}

function queryObject(url) {
  return Object.fromEntries(url.searchParams.entries());
}

function scopeFor(req) {
  const org = get(db, "SELECT * FROM organization LIMIT 1");
  const lang = "es";
  return { db, org, theme: theme(db), lang, user: currentUser(req) };
}

/* ---------------------------------------------------------------- routing */

const routes = [];
function route(method, pattern, handler) {
  const segments = pattern.split("/").filter(Boolean);
  routes.push({ method, segments, handler });
}
function matchRoute(method, pathname) {
  const parts = pathname.split("/").filter(Boolean);
  for (const r of routes) {
    if (r.method !== method || r.segments.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.segments.length; i++) {
      const s = r.segments[i];
      if (s.startsWith(":")) params[s.slice(1)] = decodeURIComponent(parts[i]);
      else if (s !== parts[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

async function serveStatic(req, res, pathname) {
  const clean = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, "public", clean);
  if (!file.startsWith(join(ROOT, "public"))) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "content-length": data.length, "cache-control": "no-cache" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------- auth */

function requireAdmin(req, res) {
  const user = currentUser(req);
  if (!user || user.role !== "ADMIN") { redirect(res, "/admin/login"); return null; }
  return user;
}
function requireStaff(req, res) {
  const user = currentUser(req);
  if (!user) { redirect(res, "/admin/login"); return null; }
  return user;
}

/* ============================== public routes ============================ */

const leagueCtx = (league, season) => views.leagueContext(db, league, season);

route("GET", "/", (req, res) => redirect(res, "/es"));
route("GET", "/:lang/tournaments", (req, res) => sendHtml(res, views.tournamentsView(scopeFor(req))));
route("GET", "/:lang/calendar", (req, res, p) => {
  const url = new URL(req.url, "http://x");
  sendHtml(res, views.calendarView(scopeFor(req), { month: url.searchParams.get("month") }));
});
route("GET", "/:lang/gallery", (req, res) => sendHtml(res, views.galleryView(scopeFor(req))));
route("GET", "/:lang/news", (req, res) => sendHtml(res, views.newsView(scopeFor(req))));
route("GET", "/:lang/news/:slug", (req, res, p) => {
  const out = views.postView(scopeFor(req), p.slug);
  sendHtml(res, out || views.notFoundView(scopeFor(req)), out ? 200 : 404);
});
route("GET", "/:lang/contact", (req, res) => {
  const url = new URL(req.url, "http://x");
  sendHtml(res, views.contactView(scopeFor(req), { sent: url.searchParams.get("sent") === "1", error: url.searchParams.get("error") || "" }));
});
route("POST", "/:lang/contact", async (req, res) => {
  const body = await readBody(req);
  if (!body.name || !body.email || !body.message) return redirect(res, "/es/contact?error=Rellena%20todos%20los%20campos%20obligatorios");
  run(db, "INSERT INTO contact_message (name, email, subject, message, created_at) VALUES (?,?,?,?,?)",
    body.name, body.email, body.subject || "", body.message, new Date().toISOString());
  redirect(res, "/es/contact?sent=1");
});

/* league --------------------------------------------------------------- */
route("GET", "/:lang/league-menu/seasons-archive", (req, res) => sendHtml(res, views.archiveView(scopeFor(req))));
route("GET", "/:lang/league-menu/seasons-archive/:season", (req, res, p) => {
  const out = views.seasonArchiveView(scopeFor(req), p.season);
  sendHtml(res, out || views.notFoundView(scopeFor(req)), out ? 200 : 404);
});
for (const [suffix, render] of [
  ["", (scope, ctx, url) => views.tablesView(scope, ctx)],
  ["/schedule", (scope, ctx) => views.scheduleView(scope, ctx)],
  ["/results", (scope, ctx, url) => views.resultsView(scope, ctx, { page: url.searchParams.get("page") })],
  ["/players-list", (scope, ctx, url) => views.playersView(scope, ctx, {
    page: url.searchParams.get("page"), sort: url.searchParams.get("sort") || "goals", team: url.searchParams.get("team") || "",
  })],
  ["/regulations", (scope, ctx) => views.regulationsView(scope, ctx)],
]) {
  route("GET", `/:lang/league-menu/:league/:season${suffix}`, (req, res, p) => {
    const scope = scopeFor(req);
    const ctx = leagueCtx(p.league, p.season);
    if (!ctx) return sendHtml(res, views.notFoundView(scope), 404);
    sendHtml(res, render(scope, ctx, new URL(req.url, "http://x")));
  });
}
route("GET", "/:lang/league-menu/:league/:season/teams/:team", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = leagueCtx(p.league, p.season);
  const out = ctx && views.teamView(scope, ctx, p.team, "about");
  sendHtml(res, out || views.notFoundView(scope), out ? 200 : 404);
});
for (const section of ["matches", "players", "gallery"]) {
  route("GET", `/:lang/league-menu/:league/:season/teams/:team/${section}`, (req, res, p) => {
    const scope = scopeFor(req);
    const ctx = leagueCtx(p.league, p.season);
    const out = ctx && views.teamView(scope, ctx, p.team, section);
    sendHtml(res, out || views.notFoundView(scope), out ? 200 : 404);
  });
}
route("GET", "/:lang/league-menu/:league/:season/teams/:team/players/:player", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = leagueCtx(p.league, p.season);
  const out = ctx && views.playerView(scope, ctx, p.team, p.player);
  sendHtml(res, out || views.notFoundView(scope), out ? 200 : 404);
});
route("GET", "/:lang/league-menu/:league/:season/games/:game", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = leagueCtx(p.league, p.season);
  const out = ctx && views.matchView(scope, ctx, "league", p.game);
  sendHtml(res, out || views.notFoundView(scope), out ? 200 : 404);
});

/* cup ------------------------------------------------------------------ */
route("GET", "/:lang/tournament-menu/:cup", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = views.cupContext(db, p.cup);
  sendHtml(res, ctx ? views.cupBracketView(scope, ctx) : views.notFoundView(scope), ctx ? 200 : 404);
});
route("GET", "/:lang/tournament-menu/:cup/final-standings", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = views.cupContext(db, p.cup);
  sendHtml(res, ctx ? views.cupFinalStandings(scope, ctx) : views.notFoundView(scope), ctx ? 200 : 404);
});
route("GET", "/:lang/tournament-menu/:cup/schedule", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = views.cupContext(db, p.cup);
  sendHtml(res, ctx ? views.cupSchedule(scope, ctx) : views.notFoundView(scope), ctx ? 200 : 404);
});
route("GET", "/:lang/tournament-menu/:cup/players-list", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = views.cupContext(db, p.cup);
  const url = new URL(req.url, "http://x");
  sendHtml(res, ctx ? views.cupPlayers(scope, ctx, { page: url.searchParams.get("page") }) : views.notFoundView(scope), ctx ? 200 : 404);
});
route("GET", "/:lang/tournament-menu/:cup/regulations", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = views.cupContext(db, p.cup);
  sendHtml(res, ctx ? views.cupRegulations(scope, ctx) : views.notFoundView(scope), ctx ? 200 : 404);
});
route("GET", "/:lang/tournament-menu/:cup/teams/:team", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = views.cupContext(db, p.cup);
  const out = ctx && views.cupTeamView(scope, ctx, p.team);
  sendHtml(res, out || views.notFoundView(scope), out ? 200 : 404);
});
route("GET", "/:lang/tournament-menu/:cup/games/:game", (req, res, p) => {
  const scope = scopeFor(req);
  const ctx = views.cupContext(db, p.cup);
  const out = ctx && views.matchView(scope, ctx, "cup", p.game);
  sendHtml(res, out || views.notFoundView(scope), out ? 200 : 404);
});

/* =============================== admin routes =========================== */

route("GET", "/admin/login", (req, res) => {
  if (currentUser(req)) return redirect(res, "/admin");
  sendHtml(res, admin.loginView(scopeFor(req)));
});
route("POST", "/admin/login", async (req, res) => {
  const body = await readBody(req);
  const user = get(db, "SELECT * FROM user WHERE email = ?", String(body.email || "").trim().toLowerCase());
  if (!user || !verifyPassword(String(body.password || ""), user.password_salt, user.password_hash)) {
    return sendHtml(res, admin.loginView(scopeFor(req), { error: "Correo o contraseña incorrectos." }), 401);
  }
  setSession(res, user.id);
  redirect(res, user.role === "REFEREE" ? "/referee" : "/admin");
});
route("POST", "/admin/logout", (req, res) => {
  clearSession(req, res);
  redirect(res, "/admin/login");
});

route("GET", "/admin", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const scope = scopeFor(req);
  const counts = {
    teams: get(db, "SELECT COUNT(*) n FROM team").n,
    players: get(db, "SELECT COUNT(*) n FROM player").n,
    games: get(db, "SELECT COUNT(*) n FROM game").n,
    goals: get(db, "SELECT COALESCE(SUM(score_home + score_away),0) n FROM game WHERE status='FINISHED'").n,
    upcoming: get(db, "SELECT COUNT(*) n FROM game WHERE status = 'NOT_STARTED'").n,
  };
  const recent = all(db, `SELECT g.id, g.game_date, g.score_home, g.score_away,
      ht.name home_name, at.name away_name
      FROM game g
      JOIN game_team gh ON gh.game_id=g.id AND gh.team_type='HOME' JOIN competition_team hc ON hc.id=gh.competition_team_id JOIN team ht ON ht.id=hc.team_id
      JOIN game_team ga ON ga.game_id=g.id AND ga.team_type='AWAY' JOIN competition_team ac ON ac.id=ga.competition_team_id JOIN team at ON at.id=ac.team_id
      WHERE g.status='FINISHED' ORDER BY g.game_date DESC LIMIT 6`);
  const upcoming = all(db, `SELECT g.id, g.game_date, ht.name home_name, at.name away_name
      FROM game g
      JOIN game_team gh ON gh.game_id=g.id AND gh.team_type='HOME' JOIN competition_team hc ON hc.id=gh.competition_team_id JOIN team ht ON ht.id=hc.team_id
      JOIN game_team ga ON ga.game_id=g.id AND ga.team_type='AWAY' JOIN competition_team ac ON ac.id=ga.competition_team_id JOIN team at ON at.id=ac.team_id
      WHERE g.status='NOT_STARTED' ORDER BY g.game_date ASC LIMIT 6`);
  const unread = get(db, "SELECT COUNT(*) n FROM contact_message WHERE read = 0").n;
  sendHtml(res, admin.dashboardView(scope, { counts, recent, upcoming, unread, user }));
});

/* teams ---------------------------------------------------------------- */
route("GET", "/admin/teams", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const teams = all(db, `SELECT t.*,
      (SELECT COUNT(*) FROM competition_player cp JOIN competition_team ct ON ct.id=cp.competition_team_id WHERE ct.team_id=t.id) players,
      (SELECT COUNT(*) FROM competition_team ct WHERE ct.team_id=t.id) competitions
    FROM team t ORDER BY t.name`);
  sendHtml(res, admin.teamsView(scopeFor(req), { teams, user, query: queryObject(new URL(req.url, "http://x")) }));
});
route("GET", "/admin/teams/new", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const competitions = repo.leagueCompetitions(db).map((c) => ({ id: c.id, name: c.name, selected: false }));
  sendHtml(res, admin.teamFormView(scopeFor(req), { team: null, competitions, user, query: queryObject(new URL(req.url, "http://x")) }));
});
route("GET", "/admin/teams/:id", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const team = get(db, "SELECT * FROM team WHERE id = ?", Number(p.id));
  if (!team) return redirect(res, "/admin/teams");
  const selected = new Set(all(db, "SELECT competition_id FROM competition_team WHERE team_id = ?", team.id).map((r) => r.competition_id));
  const competitions = repo.leagueCompetitions(db).map((c) => ({ id: c.id, name: c.name, selected: selected.has(c.id) }));
  sendHtml(res, admin.teamFormView(scopeFor(req), { team, competitions, user, query: queryObject(new URL(req.url, "http://x")) }));
});
route("POST", "/admin/teams/save", async (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const id = b.id ? Number(b.id) : null;
  const name = String(b.name || "").trim();
  if (!name) return redirect(res, "/admin/teams?err=El%20nombre%20es%20obligatorio");
  const slug = slugify(b.slug || name);
  try {
    if (id) {
      run(db, "UPDATE team SET name=?, name_short=?, slug=?, city=?, about=?, crest_url=? WHERE id=?",
        name, b.name_short || null, slug, b.city || null, b.about || null, b.crest_url || null, id);
    } else {
      const newId = Number(run(db, "INSERT INTO team (name, name_short, slug, city, about, crest_url) VALUES (?,?,?,?,?,?)",
        name, b.name_short || null, slug, b.city || null, b.about || null, b.crest_url || null).lastInsertRowid);
      b.__id = newId;
    }
    const teamId = id || b.__id;
    const wanted = new Set([].concat(b.competitions || []).map(Number));
    const current = all(db, "SELECT id, competition_id FROM competition_team WHERE team_id = ?", teamId);
    for (const row of current) {
      if (wanted.has(row.competition_id)) continue;
      const used = get(db, "SELECT COUNT(*) n FROM game_team WHERE competition_team_id = ?", row.id).n;
      if (!used) run(db, "DELETE FROM competition_team WHERE id = ?", row.id);
    }
    for (const compId of wanted) {
      run(db, "INSERT OR IGNORE INTO competition_team (competition_id, team_id) VALUES (?,?)", compId, teamId);
    }
    redirect(res, "/admin/teams?ok=Equipo%20guardado");
  } catch (e) {
    redirect(res, `/admin/teams?err=${encodeURIComponent(e.message)}`);
  }
});
route("POST", "/admin/teams/:id/delete", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const used = get(db, `SELECT COUNT(*) n FROM competition_team ct JOIN game_team gt ON gt.competition_team_id = ct.id WHERE ct.team_id = ?`, Number(p.id)).n;
  if (used) return redirect(res, "/admin/teams?err=El%20equipo%20tiene%20partidos%20y%20no%20se%20puede%20eliminar");
  try {
    run(db, "DELETE FROM team WHERE id = ?", Number(p.id));
    redirect(res, "/admin/teams?ok=Equipo%20eliminado");
  } catch (e) { redirect(res, `/admin/teams?err=${encodeURIComponent(e.message)}`); }
});

/* players -------------------------------------------------------------- */
function leagueCompetitionId() {
  const c = get(db, "SELECT id FROM competition WHERE type='LEAGUE' ORDER BY id LIMIT 1");
  return c ? c.id : null;
}
route("GET", "/admin/players", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const url = new URL(req.url, "http://x");
  const q = (url.searchParams.get("q") || "").trim();
  const teamId = url.searchParams.get("team") || "";
  const competitionId = leagueCompetitionId();
  const params = [competitionId];
  let sql = `SELECT p.*, cp.id AS competition_player_id, cp.squad_number, cp.competition_team_id,
      (p.first_name || ' ' || p.last_name) AS full_name, t.name AS team_name
    FROM player p
    LEFT JOIN competition_player cp ON cp.player_id = p.id AND cp.competition_id = ?
    LEFT JOIN competition_team ct ON ct.id = cp.competition_team_id
    LEFT JOIN team t ON t.id = ct.team_id WHERE 1=1`;
  if (q) { sql += " AND (p.first_name LIKE ? OR p.last_name LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
  if (teamId) { sql += " AND ct.team_id = ?"; params.push(Number(teamId)); }
  sql += " ORDER BY p.last_name, p.first_name LIMIT 500";
  const players = all(db, sql, ...params);
  const teams = all(db, `SELECT DISTINCT t.id, t.name FROM team t JOIN competition_team ct ON ct.team_id=t.id WHERE ct.competition_id = ? ORDER BY t.name`, competitionId);
  sendHtml(res, admin.adminPlayersView(scopeFor(req), { players, teams, q, teamId, user, query: queryObject(url) }));
});
route("GET", "/admin/players/new", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  sendHtml(res, admin.adminPlayerFormView(scopeFor(req), {
    player: null, teams: rosterTeamOptions(), user, query: queryObject(new URL(req.url, "http://x")),
  }));
});
route("GET", "/admin/players/:id", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const competitionId = leagueCompetitionId();
  const player = get(db, `SELECT p.*, cp.id AS competition_player_id, cp.squad_number, cp.competition_team_id
    FROM player p LEFT JOIN competition_player cp ON cp.player_id = p.id AND cp.competition_id = ? WHERE p.id = ?`,
    competitionId, Number(p.id));
  if (!player) return redirect(res, "/admin/players");
  sendHtml(res, admin.adminPlayerFormView(scopeFor(req), {
    player, teams: rosterTeamOptions(), user, query: queryObject(new URL(req.url, "http://x")),
  }));
});
function rosterTeamOptions() {
  return all(db, `SELECT ct.id, t.name, c.name AS competition FROM competition_team ct
    JOIN team t ON t.id = ct.team_id JOIN competition c ON c.id = ct.competition_id
    ORDER BY t.name`);
}
route("POST", "/admin/players/save", async (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const first = String(b.first_name || "").trim();
  const last = String(b.last_name || "").trim();
  if (!first || !last) return redirect(res, "/admin/players?err=El%20nombre%20es%20obligatorio");
  const slug = slugify(`${first} ${last}`);
  const id = b.id ? Number(b.id) : null;
  try {
    let playerId = id;
    if (id) {
      run(db, "UPDATE player SET first_name=?, last_name=?, slug=?, date_of_birth=?, about=?, avatar_url=? WHERE id=?",
        first, last, slug, b.date_of_birth || null, b.about || null, b.avatar_url || null, id);
    } else {
      playerId = Number(run(db, "INSERT INTO player (first_name, last_name, slug, date_of_birth, about, avatar_url) VALUES (?,?,?,?,?,?)",
        first, last, slug, b.date_of_birth || null, b.about || null, b.avatar_url || null).lastInsertRowid);
    }
    const competitionId = leagueCompetitionId();
    const ctId = b.competition_team_id ? Number(b.competition_team_id) : null;
    if (ctId) {
      const existing = get(db, "SELECT id FROM competition_player WHERE competition_id = ? AND player_id = ?", competitionId, playerId);
      if (existing) {
        run(db, "UPDATE competition_player SET competition_team_id=?, squad_number=? WHERE id=?", ctId, b.squad_number || null, existing.id);
      } else {
        run(db, "INSERT INTO competition_player (competition_id, competition_team_id, player_id, squad_number) VALUES (?,?,?,?)",
          competitionId, ctId, playerId, b.squad_number || null);
      }
    }
    redirect(res, "/admin/players?ok=Jugador%20guardado");
  } catch (e) {
    redirect(res, `/admin/players?err=${encodeURIComponent(e.message)}`);
  }
});
route("POST", "/admin/players/:id/delete", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  try {
    run(db, "DELETE FROM player WHERE id = ?", Number(p.id));
    redirect(res, "/admin/players?ok=Jugador%20eliminado");
  } catch (e) { redirect(res, `/admin/players?err=${encodeURIComponent(e.message)}`); }
});

/* competitions --------------------------------------------------------- */
route("GET", "/admin/competitions", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const competitions = all(db, `SELECT c.*, s.name AS season_name,
      (SELECT COUNT(*) FROM competition_team ct WHERE ct.competition_id=c.id) teams,
      (SELECT COUNT(*) FROM game g JOIN round r ON r.id=g.round_id WHERE r.competition_id=c.id) games
    FROM competition c LEFT JOIN season s ON s.id=c.season_id ORDER BY c.id`);
  sendHtml(res, admin.competitionsView(scopeFor(req), { competitions, user, query: queryObject(new URL(req.url, "http://x")) }));
});
route("GET", "/admin/competitions/:id", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const competition = get(db, `SELECT c.*, s.name AS season_name FROM competition c LEFT JOIN season s ON s.id=c.season_id WHERE c.id = ?`, Number(p.id));
  if (!competition) return redirect(res, "/admin/competitions");
  sendHtml(res, admin.competitionFormView(scopeFor(req), { competition, user, query: queryObject(new URL(req.url, "http://x")) }));
});
route("POST", "/admin/competitions/:id/save", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  run(db, `UPDATE competition SET name=?, half_time=?, points_win=?, points_draw=?, points_lose=?,
      ranking_points=?, ranking_goal_diff=?, ranking_goals_scored=?, red_card_suspension_matches=?, is_archive=? WHERE id=?`,
    b.name, Number(b.half_time) || 10, Number(b.points_win), Number(b.points_draw), Number(b.points_lose),
    b.ranking_points, b.ranking_goal_diff, b.ranking_goals_scored,
    Number(b.red_card_matches) || 0, b.is_archive ? 1 : 0, Number(p.id));
  redirect(res, `/admin/competitions/${p.id}?ok=Ajustes%20guardados`);
});

/* schedule ------------------------------------------------------------- */
route("GET", "/admin/schedule", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const url = new URL(req.url, "http://x");
  const competitions = repo.leagueCompetitions(db).concat(repo.cupCompetitions(db));
  const selected = Number(url.searchParams.get("competition") || competitions[0]?.id);
  const rounds = all(db, `SELECT r.*,
      (SELECT COUNT(*) FROM game g WHERE g.round_id=r.id) games,
      (SELECT COUNT(*) FROM game g WHERE g.round_id=r.id AND g.status='FINISHED') finished
    FROM round r WHERE r.competition_id = ? ORDER BY r.id`, selected);
  sendHtml(res, admin.scheduleAdminView(scopeFor(req), {
    competitions, selected, rounds, pitches: all(db, "SELECT * FROM pitch ORDER BY name"),
    user, query: queryObject(url),
  }));
});
route("POST", "/admin/schedule/generate", async (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  try {
    const competitionId = Number(b.competition_id);
    const times = String(b.times || "18:00").split(",").map((t) => t.trim()).filter(Boolean);
    for (const t of times) if (!/^\d{1,2}:\d{2}$/.test(t)) throw new Error(`Invalid time: ${t}`);
    const created = generateSchedule(db, competitionId, {
      startDate: b.start_date,
      weekday: Number(b.weekday ?? 6),
      times,
      pitchId: b.pitch_id ? Number(b.pitch_id) : null,
      doubleRound: Boolean(b.double_round),
      timeZone: scopeFor(req).theme.timezone,
    });
    run(db, "INSERT INTO change_log (user_id, action, target, detail, created_at) VALUES (?,?,?,?,?)",
      user.id, "GENERATE_SCHEDULE", `competition:${competitionId}`, JSON.stringify({ rounds: created.length }), new Date().toISOString());
    redirect(res, `/admin/schedule?competition=${competitionId}&ok=${encodeURIComponent(`${created.length} jornadas generadas`)}`);
  } catch (e) {
    redirect(res, `/admin/schedule?err=${encodeURIComponent(e.message)}`);
  }
});
route("POST", "/admin/schedule/rounds/:id/delete", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const round = get(db, "SELECT * FROM round WHERE id = ?", Number(p.id));
  if (!round) return redirect(res, "/admin/schedule");
  const finished = get(db, "SELECT COUNT(*) n FROM game WHERE round_id = ? AND status='FINISHED'", round.id).n;
  if (finished) return redirect(res, `/admin/schedule?competition=${round.competition_id}&err=${encodeURIComponent("La jornada ya tiene partidos finalizados")}`);
  run(db, "DELETE FROM round WHERE id = ?", round.id);
  redirect(res, `/admin/schedule?competition=${round.competition_id}&ok=Jornada%20eliminada`);
});

/* games ---------------------------------------------------------------- */
route("GET", "/admin/games", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const url = new URL(req.url, "http://x");
  const competitions = repo.leagueCompetitions(db).concat(repo.cupCompetitions(db));
  const competitionId = url.searchParams.get("competition") || "";
  const status = url.searchParams.get("status") || "";
  const roundId = url.searchParams.get("round") || "";
  const params = [];
  let sql = `SELECT g.id, g.game_date, g.status, g.score_home, g.score_away,
      ht.name home_name, at.name away_name, c.name competition_name
    FROM game g
    JOIN round r ON r.id=g.round_id JOIN competition c ON c.id=r.competition_id
    JOIN game_team gh ON gh.game_id=g.id AND gh.team_type='HOME' JOIN competition_team hc ON hc.id=gh.competition_team_id JOIN team ht ON ht.id=hc.team_id
    JOIN game_team ga ON ga.game_id=g.id AND ga.team_type='AWAY' JOIN competition_team ac ON ac.id=ga.competition_team_id JOIN team at ON at.id=ac.team_id
    WHERE 1=1`;
  if (competitionId) { sql += " AND r.competition_id = ?"; params.push(Number(competitionId)); }
  if (status) { sql += " AND g.status = ?"; params.push(status); }
  if (roundId) { sql += " AND g.round_id = ?"; params.push(Number(roundId)); }
  sql += " ORDER BY g.game_date DESC LIMIT 200";
  sendHtml(res, admin.adminGamesView(scopeFor(req), {
    games: all(db, sql, ...params), competitions, competitionId, status, roundId, user, query: queryObject(url),
  }));
});
function gameData(gameId) {
  const game = repo.gameById(db, gameId);
  if (!game) return null;
  const eventTypes = all(db, "SELECT * FROM event_type ORDER BY id");
  const roster = (ct) => all(db, `SELECT cp.id AS competition_player_id, cp.squad_number,
      (p.first_name || ' ' || p.last_name) AS full_name, t.name AS team_name,
      (SELECT COUNT(*) FROM event e JOIN event_type et ON et.id=e.event_type_id
        WHERE e.game_id = ? AND e.game_player_id IN (SELECT id FROM game_player WHERE game_id=? AND competition_player_id=cp.id)
        AND et.system_name IN ('goal','own_goal')) AS goals
    FROM competition_player cp JOIN player p ON p.id=cp.player_id
    JOIN competition_team cte ON cte.id=cp.competition_team_id JOIN team t ON t.id=cte.team_id
    WHERE cp.competition_team_id = ? ORDER BY (cp.squad_number IS NULL), cp.squad_number`, game.id, game.id, ct);
  const inSquad = new Set(all(db, "SELECT competition_player_id FROM game_player WHERE game_id = ?", game.id).map((r) => r.competition_player_id));
  const withSquad = (list) => list.map((p) => ({ ...p, in_squad: inSquad.has(p.competition_player_id) }));
  return {
    game, eventTypes,
    events: repo.gameEvents(db, game.id),
    homePlayers: withSquad(roster(game.home_ct)),
    awayPlayers: withSquad(roster(game.away_ct)),
  };
}
route("GET", "/admin/games/:id", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const data = gameData(Number(p.id));
  if (!data) return redirect(res, "/admin/games");
  sendHtml(res, admin.adminGameEditView(scopeFor(req), { ...data, user, query: queryObject(new URL(req.url, "http://x")) }));
});
route("POST", "/admin/games/:id/save", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const gameId = Number(p.id);
  const scoreHome = b.score_home === "" ? null : Number(b.score_home);
  const scoreAway = b.score_away === "" ? null : Number(b.score_away);
  run(db, `UPDATE game SET score_home=?, score_away=?, penalty_score_home=?, penalty_score_away=?, status=?,
      code=?, game_date=COALESCE(?, game_date) WHERE id=?`,
    scoreHome, scoreAway,
    b.penalty_score_home === "" ? null : Number(b.penalty_score_home),
    b.penalty_score_away === "" ? null : Number(b.penalty_score_away),
    b.status || "NOT_STARTED", b.code || null,
    b.game_date ? new Date(b.game_date).toISOString() : null, gameId);
  if (b.status === "FINISHED") countGameStats(gameId);
  redirect(res, `/admin/games/${gameId}?ok=Resultado%20guardado`);
});
route("POST", "/admin/games/:id/events", async (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  const gameId = Number(p.id);
  const cpId = Number(b.competition_player_id);
  if (!cpId) return redirect(res, `/admin/games/${gameId}?err=Elige%20un%20jugador`);
  addEvent(gameId, cpId, Number(b.event_type_id), Number(b.time) || 1);
  redirect(res, `/admin/games/${gameId}?ok=Evento%20a%C3%B1adido`);
});
route("POST", "/admin/games/:id/events/:eventId/delete", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  deleteEvent(Number(p.id), Number(p.eventId));
  redirect(res, `/admin/games/${p.id}?ok=Evento%20eliminado`);
});

/* messages + settings -------------------------------------------------- */
route("GET", "/admin/messages", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  sendHtml(res, admin.messagesView(scopeFor(req), {
    messages: all(db, "SELECT * FROM contact_message ORDER BY created_at DESC"), user, query: queryObject(new URL(req.url, "http://x")),
  }));
});
route("POST", "/admin/messages/:id/read", (req, res, p) => {
  const user = requireAdmin(req, res); if (!user) return;
  run(db, "UPDATE contact_message SET read = 1 WHERE id = ?", Number(p.id));
  redirect(res, "/admin/messages?ok=Mensaje%20marcado%20como%20le%C3%ADdo");
});
route("GET", "/admin/settings", (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  sendHtml(res, admin.settingsView(scopeFor(req), {
    org: get(db, "SELECT * FROM organization LIMIT 1"),
    sponsors: repo.sponsors(db),
    contactFields: all(db, "SELECT * FROM contact_field ORDER BY id"),
    user, query: queryObject(new URL(req.url, "http://x")),
  }));
});
route("POST", "/admin/settings/save", async (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const b = await readBody(req);
  run(db, `UPDATE organization SET name=?, contact_email=?, primary_color=?, secondary_color=?,
      background_accent_color=?, socials_json=? WHERE id = (SELECT id FROM organization LIMIT 1)`,
    b.name, b.contact_email || null, b.primary_color, b.secondary_color, b.background_accent_color,
    JSON.stringify({ facebook: b.social_facebook_url, instagram: b.social_instagram_url, youtube: b.social_youtube_url }));
  redirect(res, "/admin/settings?ok=Ajustes%20guardados");
});

/* ============================== referee routes ========================== */

route("GET", "/referee", (req, res) => {
  const user = requireStaff(req, res); if (!user) return;
  const today = new Date().toISOString().slice(0, 10);
  let games = all(db, `SELECT g.id, g.game_date, g.status, ht.name home_name, at.name away_name
      FROM game g
      JOIN game_team gh ON gh.game_id=g.id AND gh.team_type='HOME' JOIN competition_team hc ON hc.id=gh.competition_team_id JOIN team ht ON ht.id=hc.team_id
      JOIN game_team ga ON ga.game_id=g.id AND ga.team_type='AWAY' JOIN competition_team ac ON ac.id=ga.competition_team_id JOIN team at ON at.id=ac.team_id
      WHERE g.status IN ('NOT_STARTED','STARTED','BREAK') AND g.game_date >= ?
      ORDER BY g.game_date ASC LIMIT 20`, new Date(`${today}T00:00:00Z`).toISOString());
  const isToday = games.length > 0;
  if (games.length === 0) {
    games = all(db, `SELECT g.id, g.game_date, g.status, ht.name home_name, at.name away_name
      FROM game g
      JOIN game_team gh ON gh.game_id=g.id AND gh.team_type='HOME' JOIN competition_team hc ON hc.id=gh.competition_team_id JOIN team ht ON ht.id=hc.team_id
      JOIN game_team ga ON ga.game_id=g.id AND ga.team_type='AWAY' JOIN competition_team ac ON ac.id=ga.competition_team_id JOIN team at ON at.id=ac.team_id
      WHERE g.status IN ('NOT_STARTED','STARTED','BREAK') ORDER BY g.game_date ASC LIMIT 20`);
  }
  sendHtml(res, admin.refereeHomeView(scopeFor(req), { games, user, today: isToday }));
});
route("GET", "/referee/game/:id", (req, res, p) => {
  const user = requireStaff(req, res); if (!user) return;
  const data = gameData(Number(p.id));
  if (!data) return redirect(res, "/referee");
  sendHtml(res, admin.refereeGameView(scopeFor(req), { ...data, user }));
});

function recomputeScore(gameId) {
  const game = get(db, "SELECT * FROM game WHERE id = ?", gameId);
  if (!game) return;
  const events = all(db, `SELECT et.system_name, cp.competition_team_id AS team_ct
    FROM event e JOIN event_type et ON et.id=e.event_type_id
    JOIN game_player gp ON gp.id=e.game_player_id
    JOIN competition_player cp ON cp.id=gp.competition_player_id
    WHERE e.game_id = ? AND et.system_name IN ('goal','own_goal')`, gameId);
  const teams = all(db, "SELECT competition_team_id, team_type FROM game_team WHERE game_id = ?", gameId);
  const home = teams.find((t) => t.team_type === "HOME")?.competition_team_id;
  const away = teams.find((t) => t.team_type === "AWAY")?.competition_team_id;
  const side = new Map([[home, "home"], [away, "away"]]);
  let hs = 0, as = 0;
  for (const e of events) {
    let scorer = e.team_ct;
    if (e.system_name === "own_goal") scorer = scorer === home ? away : home;
    if (scorer === home) hs++; else as++;
  }
  run(db, "UPDATE game SET score_home=?, score_away=? WHERE id=?", hs, as, gameId);
}
function addEvent(gameId, cpId, eventTypeId, minute) {
  let gp = get(db, "SELECT id FROM game_player WHERE game_id = ? AND competition_player_id = ?", gameId, cpId);
  if (!gp) {
    const row = get(db, "SELECT cp.squad_number, cp.competition_team_id FROM competition_player cp WHERE cp.id = ?", cpId);
    const id = Number(run(db, "INSERT INTO game_player (game_id, competition_player_id, squad_number) VALUES (?,?,?)",
      gameId, cpId, row?.squad_number ?? null).lastInsertRowid);
    gp = { id };
  }
  run(db, "INSERT INTO event (game_id, game_player_id, event_type_id, time) VALUES (?,?,?,?)", gameId, gp.id, eventTypeId, minute);
  recomputeScore(gameId);
  run(db, "UPDATE game SET status = CASE WHEN status='NOT_STARTED' THEN 'STARTED' ELSE status END WHERE id = ?", gameId);
}
function deleteEvent(gameId, eventId) {
  run(db, "DELETE FROM event WHERE id = ? AND game_id = ?", eventId, gameId);
  recomputeScore(gameId);
}
function countGameStats(gameId) {
  const game = get(db, "SELECT stats_counted FROM game WHERE id = ?", gameId);
  if (!game || game.stats_counted) return;
  const players = all(db, "SELECT DISTINCT competition_player_id FROM game_player WHERE game_id = ?", gameId);
  for (const { competition_player_id: cpId } of players) {
    const exists = get(db, "SELECT competition_player_id FROM player_stat_base WHERE competition_player_id = ?", cpId);
    if (exists) run(db, "UPDATE player_stat_base SET games = games + 1 WHERE competition_player_id = ?", cpId);
    else run(db, "INSERT INTO player_stat_base (competition_player_id, games) VALUES (?, 1)", cpId);
  }
  run(db, "UPDATE game SET stats_counted = 1 WHERE id = ?", gameId);
}

route("POST", "/referee/game/:id/status", async (req, res, p) => {
  const user = requireStaff(req, res); if (!user) return;
  const b = await readBody(req);
  const status = ["NOT_STARTED", "STARTED", "BREAK", "FINISHED", "CANCELED"].includes(b.status) ? b.status : "STARTED";
  const gameId = Number(p.id);
  if (status === "FINISHED") {
    const g = get(db, "SELECT score_home, score_away FROM game WHERE id = ?", gameId);
    if (g.score_home === null || g.score_away === null) recomputeScore(gameId);
    countGameStats(gameId);
  }
  run(db, "UPDATE game SET status = ? WHERE id = ?", status, gameId);
  redirect(res, `/referee/game/${gameId}?ok=Estado%20actualizado`);
});
route("POST", "/referee/game/:id/score", async (req, res, p) => {
  const user = requireStaff(req, res); if (!user) return;
  const b = await readBody(req);
  run(db, "UPDATE game SET score_home=?, score_away=? WHERE id=?",
    Number(b.score_home) || 0, Number(b.score_away) || 0, Number(p.id));
  redirect(res, `/referee/game/${p.id}?ok=Marcador%20corregido`);
});
route("POST", "/referee/game/:id/events", async (req, res, p) => {
  const user = requireStaff(req, res); if (!user) return;
  const b = await readBody(req);
  const value = String(b.submit || "");
  const [teamCt, cpId] = value.split(":").map(Number);
  if (!teamCt || !cpId) return redirect(res, `/referee/game/${p.id}?err=Elige%20un%20jugador`);
  const typeId = Number(b.event_type_id);
  const minute = Math.max(1, Math.min(120, Number(b.time) || 1));
  addEvent(Number(p.id), cpId, typeId, minute);
  redirect(res, `/referee/game/${p.id}?ok=Evento%20registrado`);
});
route("POST", "/referee/game/:id/events/:eventId/delete", (req, res, p) => {
  const user = requireStaff(req, res); if (!user) return;
  deleteEvent(Number(p.id), Number(p.eventId));
  redirect(res, `/referee/game/${p.id}?ok=Evento%20eliminado`);
});
route("POST", "/referee/game/:id/squad", async (req, res, p) => {
  const user = requireStaff(req, res); if (!user) return;
  const b = await readBody(req);
  const gameId = Number(p.id);
  const wanted = new Set([].concat(b.player || []).map(Number));
  const existing = all(db, "SELECT id, competition_player_id FROM game_player WHERE game_id = ?", gameId);
  const present = new Set(existing.map((row) => row.competition_player_id));
  for (const row of existing) {
    if (wanted.has(row.competition_player_id)) continue;
    const hasEvents = get(db, "SELECT COUNT(*) n FROM event WHERE game_player_id = ?", row.id).n;
    if (!hasEvents) run(db, "DELETE FROM game_player WHERE id = ?", row.id);
  }
  for (const cpId of wanted) {
    if (present.has(cpId)) continue;
    const row = get(db, "SELECT squad_number FROM competition_player WHERE id = ?", cpId);
    run(db, "INSERT OR IGNORE INTO game_player (game_id, competition_player_id, squad_number) VALUES (?,?,?)", gameId, cpId, row?.squad_number ?? null);
  }
  redirect(res, `/referee/game/${gameId}?ok=Convocatoria%20guardada`);
});

/* ------------------------------------------------------------------ home */

// Registered after the admin and referee sections so those one-segment paths
// are not mistaken for a language code.
route("GET", "/:lang", (req, res) => sendHtml(res, views.homeView(scopeFor(req))));

/* ------------------------------------------------------------------ 404 */

async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && (url.pathname === "/styles.css" || url.pathname === "/referee.js" || url.pathname === "/admin.js")) {
      if (await serveStatic(req, res, url.pathname)) return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/public/")) {
      if (await serveStatic(req, res, url.pathname.slice(7))) return;
    }
    const found = matchRoute(req.method, url.pathname);
    if (found) return await found.handler(req, res, found.params);
    // Language-less public paths are redirected to /es for convenience.
    const legacy = ["/league-menu", "/tournament-menu", "/calendar", "/contact", "/gallery", "/news"];
    if (legacy.some((p) => url.pathname.startsWith(p))) return redirect(res, `/es${url.pathname}${url.search}`);
    sendHtml(res, views.notFoundView(scopeFor(req)), 404);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Internal error: ${error.message}`);
    }
  }
}

createServer(handler).listen(PORT, HOST, () => {
  console.log(`FLM clone running at http://${HOST}:${PORT}`);
  console.log(`  Public site : http://${HOST}:${PORT}/es`);
  console.log(`  Admin       : http://${HOST}:${PORT}/admin  (admin@aquaopen.local / Admin123!)`);
  console.log(`  Referee     : http://${HOST}:${PORT}/referee  (referee@aquaopen.local / Referee123!)`);
});
