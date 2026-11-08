// Minimal defaults so a fresh database is immediately usable: one organisation,
// one season/competition shell, one administrator and the event-type catalogue.
// It only fills what is missing, so it is safe to run on every start.
import { randomBytes } from "node:crypto";
import { hashPassword } from "./domain.mjs";
import { get, run } from "./db.mjs";

const EVENT_TYPES = [
  ["Gol", "goal"],
  ["Gol en propia", "own_goal"],
  ["Asistencia", "assist"],
  ["MVP", "mvp"],
  ["Tarjeta amarilla", "yellow_card"],
  ["Tarjeta roja", "red_card"],
];

export function ensureBootstrap(db) {
  // Read the environment at call time: importers (like the smoke test) set these
  // variables after their static imports are hoisted, so module-load capture breaks them.
  const adminEmail = process.env.LIGAS_ADMIN_EMAIL || "admin@liga.local";
  const adminPassword = process.env.LIGAS_ADMIN_PASSWORD || null;

  if (!get(db, "SELECT id FROM organization LIMIT 1")) {
    run(
      db,
      `INSERT INTO organization
         (name, primary_color, secondary_color, background_color, background_accent_color,
          text_color, text_secondary_color, timezone, socials_json)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      "Mi Liga", "#006fff", "#0500ff", "#ffffff", "#e1e9f4",
      "#2c3034", "#505c66", "America/Argentina/Buenos_Aires", "{}"
    );
  }

  for (const [name, system] of EVENT_TYPES) {
    run(db, "INSERT OR IGNORE INTO event_type (name, system_name) VALUES (?,?)", name, system);
  }

  const year = new Date().getFullYear();
  if (!get(db, "SELECT id FROM season LIMIT 1")) {
    run(db, "INSERT INTO season (name, slug) VALUES (?,?)", `Temporada ${year}`, String(year));
  }
  if (!get(db, "SELECT id FROM competition LIMIT 1")) {
    const season = get(db, "SELECT id FROM season ORDER BY id LIMIT 1");
    const compId = run(
      db,
      `INSERT INTO competition (slug, name, kind, season_id) VALUES (?,?,?,?)`,
      "mi-liga", "Mi Liga", "LIGA", season.id
    ).lastInsertRowid;
    run(
      db,
      `INSERT INTO competition_group (competition_id, name, slug, ordering) VALUES (?,?,?,?)`,
      Number(compId), "Grupo A", "grupo-a", 1
    );
  }

  if (!get(db, "SELECT id FROM user LIMIT 1")) {
    const password = adminPassword || randomBytes(12).toString("base64url");
    const { hash, salt } = hashPassword(password);
    run(
      db,
      "INSERT INTO user (email, name, password_hash, password_salt, role) VALUES (?,?,?,?,?)",
      adminEmail, "Administrador", hash, salt, "ADMIN"
    );
    console.log(`  Administrador creado: ${adminEmail}`);
    if (!adminPassword) console.log(`  Contraseña inicial (guárdala, no se vuelve a mostrar): ${password}`);
  }
}
