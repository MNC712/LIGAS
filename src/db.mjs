// SQLite schema and connection helpers.
// The table set mirrors the object types observed in the public GraphQL schema
// (Competition, CompetitionTeam, CompetitionPlayer, Round, Game, GameTeam,
// GamePlayer, Event, EventType, Team, Player, Pitch, Season, League).
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
  domain TEXT,
  primary_color TEXT, secondary_color TEXT,
  background_color TEXT, background_accent_color TEXT,
  text_color TEXT, text_secondary_color TEXT,
  home_url TEXT, contact_email TEXT, timezone TEXT,
  date_format TEXT, time_format TEXT,
  news_page_enabled INTEGER DEFAULT 1,
  contact_page_enabled INTEGER DEFAULT 1,
  gallery_page_enabled INTEGER DEFAULT 1,
  home_page_enabled INTEGER DEFAULT 1,
  logo_url TEXT, banner_url TEXT,
  gallery_json TEXT DEFAULT '[]',
  socials_json TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS sponsor (
  id INTEGER PRIMARY KEY, name TEXT, url TEXT, image_url TEXT
);

CREATE TABLE IF NOT EXISTS contact_field (
  id INTEGER PRIMARY KEY, name TEXT, value TEXT
);

CREATE TABLE IF NOT EXISTS post (
  id INTEGER PRIMARY KEY, title TEXT, slug TEXT UNIQUE, content TEXT,
  featured INTEGER DEFAULT 0, created_at TEXT, image_url TEXT
);

CREATE TABLE IF NOT EXISTS season (
  id INTEGER PRIMARY KEY, name TEXT, slug TEXT UNIQUE,
  start_date TEXT, end_date TEXT, regulations TEXT,
  classification_enabled INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS league (
  id INTEGER PRIMARY KEY, name TEXT, slug TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS competition (
  id INTEGER PRIMARY KEY,
  slug TEXT, name TEXT, type TEXT NOT NULL CHECK (type IN ('LEAGUE','CUP')),
  state TEXT DEFAULT 'PUBLISHED', is_archive INTEGER DEFAULT 1,
  about TEXT, regulations TEXT,
  league_id INTEGER REFERENCES league(id),
  season_id INTEGER REFERENCES season(id),
  points_win INTEGER DEFAULT 3, points_draw INTEGER DEFAULT 1, points_lose INTEGER DEFAULT 0,
  ranking_points TEXT DEFAULT 'DESC', ranking_head_to_head TEXT DEFAULT 'DESC',
  ranking_goal_diff TEXT DEFAULT 'DESC', ranking_goals_scored TEXT DEFAULT 'DESC',
  ranking_wins TEXT DEFAULT 'DESC',
  cup_name TEXT, cup_start_date TEXT, cup_end_date TEXT,
  cup_format TEXT, cup_phase TEXT, placement_depth INTEGER,
  half_time INTEGER DEFAULT 10, red_card_suspension_matches INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS team (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT NOT NULL,
  name_short TEXT, city TEXT, about TEXT, crest_url TEXT, image_url TEXT
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

CREATE TABLE IF NOT EXISTS round (
  id INTEGER PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  name TEXT, cup_phase TEXT, cup_bracket TEXT,
  cup_bracket_order INTEGER, cup_bracket_round INTEGER, elimination_format TEXT
);

CREATE TABLE IF NOT EXISTS pitch (
  id INTEGER PRIMARY KEY, name TEXT, address TEXT, city TEXT, slug TEXT
);

CREATE TABLE IF NOT EXISTS game (
  id INTEGER PRIMARY KEY,
  round_id INTEGER REFERENCES round(id) ON DELETE SET NULL,
  pitch_id INTEGER REFERENCES pitch(id) ON DELETE SET NULL,
  game_date TEXT, status TEXT DEFAULT 'NOT_STARTED'
    CHECK (status IN ('NOT_STARTED','STARTED','BREAK','FINISHED','CANCELED')),
  score_home INTEGER, score_away INTEGER,
  penalty_score_home INTEGER, penalty_score_away INTEGER,
  code TEXT, about TEXT, video TEXT,
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

-- Season aggregates observed from the public API are split into a base value
-- plus the events we actually hold, so recomputation keeps the published
-- numbers exact while new referee events still move the totals.
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

CREATE TABLE IF NOT EXISTS contact_message (
  id INTEGER PRIMARY KEY, name TEXT, email TEXT, subject TEXT, message TEXT,
  created_at TEXT, read INTEGER DEFAULT 0
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
