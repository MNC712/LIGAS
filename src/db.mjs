// SQLite schema and connection helpers for the LIGAS "grupos + playoff" model.
//
// A competition is played in two stages: a group stage (each group has its own
// table) and a knockout playoff. Both stages are just rounds: a round either
// belongs to a group (`stage = 'GROUP'`, `group_id` set) or is a playoff round
// (`stage = 'PLAYOFF'`). Every match is registered by hand from the admin
// console, so there is no automatic fixture generator.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");
export const DB_PATH = process.env.FLM_DB || join(ROOT, "data", "flm.db");

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS organization (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  primary_color TEXT, secondary_color TEXT,
  background_color TEXT, background_accent_color TEXT,
  text_color TEXT, text_secondary_color TEXT,
  timezone TEXT,
  logo_url TEXT,
  socials_json TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS season (
  id INTEGER PRIMARY KEY, name TEXT, slug TEXT UNIQUE,
  start_date TEXT, end_date TEXT, regulations TEXT,
  classification_enabled INTEGER DEFAULT 0
);

-- The template the competition was created from: LIGA (one group), TORNEO
-- (groups + playoff) or COPA (playoff only). It is informational: the actual
-- structure lives in competition_group and round and is edited by hand.
CREATE TABLE IF NOT EXISTS competition (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE, name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'TORNEO' CHECK (kind IN ('LIGA','TORNEO','COPA')),
  season_id INTEGER REFERENCES season(id),
  start_date TEXT, end_date TEXT, location TEXT,
  state TEXT DEFAULT 'PUBLISHED', is_archive INTEGER DEFAULT 0,
  about TEXT, regulations TEXT,
  points_win INTEGER DEFAULT 3, points_draw INTEGER DEFAULT 1, points_lose INTEGER DEFAULT 0,
  ranking_points TEXT DEFAULT 'DESC', ranking_goal_diff TEXT DEFAULT 'DESC',
  ranking_goals_scored TEXT DEFAULT 'DESC', ranking_wins TEXT DEFAULT 'DESC',
  half_time INTEGER DEFAULT 10, red_card_suspension_matches INTEGER DEFAULT 1
);

-- Organisation-wide sponsors: name, logo and an outbound link. Shown on the
-- public home and in the footer of every public page when active.
CREATE TABLE IF NOT EXISTS sponsor (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT, link_url TEXT,
  ordering INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);

-- A group inside a competition's group stage. Teams are assigned to a group
-- through competition_team.group_id.
CREATE TABLE IF NOT EXISTS competition_group (
  id INTEGER PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT, ordering INTEGER DEFAULT 0,
  UNIQUE (competition_id, slug)
);

CREATE TABLE IF NOT EXISTS team (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT NOT NULL,
  name_short TEXT, city TEXT, about TEXT, crest_url TEXT
);

CREATE TABLE IF NOT EXISTS team_image (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS competition_team (
  id INTEGER PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES competition_group(id) ON DELETE SET NULL,
  UNIQUE (competition_id, team_id)
);

CREATE TABLE IF NOT EXISTS player (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE, first_name TEXT, last_name TEXT,
  date_of_birth TEXT, about TEXT, avatar_url TEXT
);

CREATE TABLE IF NOT EXISTS competition_player (
  id INTEGER PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  competition_team_id INTEGER NOT NULL REFERENCES competition_team(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  squad_number INTEGER,
  UNIQUE (competition_id, player_id)
);

-- Group-stage rounds carry their group and stage = 'GROUP'; playoff rounds
-- keep group_id empty and use stage = 'PLAYOFF'. ordering fixes the
-- display order the administrator chooses.
CREATE TABLE IF NOT EXISTS round (
  id INTEGER PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES competition_group(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'GROUP' CHECK (stage IN ('GROUP','PLAYOFF')),
  name TEXT, ordering INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pitch (
  id INTEGER PRIMARY KEY, name TEXT, address TEXT, city TEXT
);

CREATE TABLE IF NOT EXISTS game (
  id INTEGER PRIMARY KEY,
  round_id INTEGER REFERENCES round(id) ON DELETE SET NULL,
  pitch_id INTEGER REFERENCES pitch(id) ON DELETE SET NULL,
  game_date TEXT, status TEXT DEFAULT 'NOT_STARTED'
    CHECK (status IN ('NOT_STARTED','STARTED','BREAK','FINISHED','CANCELED')),
  score_home INTEGER, score_away INTEGER,
  penalty_score_home INTEGER, penalty_score_away INTEGER,
  code TEXT,
  stats_counted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_team (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  competition_team_id INTEGER NOT NULL REFERENCES competition_team(id) ON DELETE CASCADE,
  team_type TEXT NOT NULL CHECK (team_type IN ('HOME','AWAY')),
  UNIQUE (game_id, team_type)
);

CREATE TABLE IF NOT EXISTS game_player (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  competition_player_id INTEGER NOT NULL REFERENCES competition_player(id) ON DELETE CASCADE,
  squad_number INTEGER, participation TEXT DEFAULT 'STARTING'
);
CREATE UNIQUE INDEX IF NOT EXISTS game_player_unique
  ON game_player (game_id, competition_player_id);

CREATE TABLE IF NOT EXISTS event_type (
  id INTEGER PRIMARY KEY, name TEXT, system_name TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS event (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  game_player_id INTEGER REFERENCES game_player(id) ON DELETE CASCADE,
  event_type_id INTEGER NOT NULL REFERENCES event_type(id),
  time INTEGER, in_additional_time INTEGER DEFAULT 0,
  for_opposite_team INTEGER DEFAULT 0, name TEXT
);

-- A baseline for each player's season totals, kept apart from the events we
-- hold, so recomputation adds the recorded events on top of any starting
-- numbers while referee edits still move the totals.
CREATE TABLE IF NOT EXISTS player_stat_base (
  competition_player_id INTEGER PRIMARY KEY REFERENCES competition_player(id) ON DELETE CASCADE,
  games INTEGER DEFAULT 0,
  goals INTEGER DEFAULT 0, assists INTEGER DEFAULT 0, mvp INTEGER DEFAULT 0,
  yellow INTEGER DEFAULT 0, red INTEGER DEFAULT 0, conceded INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
  password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','REFEREE'))
);

CREATE TABLE IF NOT EXISTS session (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, target TEXT,
  detail TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY, value TEXT
);
`;

export function openDb(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // Migration: add competition columns missing in databases created by older
  // versions. Competitions created before `kind` existed were league-like.
  const competitionCols = new Set(
    db.prepare("PRAGMA table_info(competition)").all().map((c) => c.name)
  );
  if (!competitionCols.has("kind")) {
    db.exec("ALTER TABLE competition ADD COLUMN kind TEXT NOT NULL DEFAULT 'TORNEO'");
    db.exec("UPDATE competition SET kind = 'LIGA'");
  }
  for (const col of ["start_date", "end_date", "location"]) {
    if (!competitionCols.has(col)) {
      db.exec(`ALTER TABLE competition ADD COLUMN ${col} TEXT`);
    }
  }
  return db;
}

export function resetDb(path = DB_PATH) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch {}
  }
  return openDb(path);
}

export const all = (db, sql, ...params) => db.prepare(sql).all(...params);
export const get = (db, sql, ...params) => db.prepare(sql).get(...params);
export const run = (db, sql, ...params) => db.prepare(sql).run(...params);
