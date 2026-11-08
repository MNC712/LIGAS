// Administration console and referee application views.
import { html, raw, icons, crest, escapeHtml } from "./render.mjs";
import { fmtDate, fmtDateTime, fmtTime, statusLabel, localParts } from "./domain.mjs";

const NAV = [
  { key: "dashboard", href: "/admin", label: "Panel", icon: "chart" },
  { key: "teams", href: "/admin/teams", label: "Equipos", icon: "shield" },
  { key: "players", href: "/admin/players", label: "Jugadores", icon: "users" },
  { key: "competitions", href: "/admin/competitions", label: "Competiciones", icon: "trophy" },
  { key: "games", href: "/admin/games", label: "Partidos y resultados", icon: "ball" },
  { key: "sponsors", href: "/admin/sponsors", label: "Patrocinadores", icon: "star" },
  { key: "referee", href: "/referee", label: "Árbitro", icon: "whistle" },
  { key: "settings", href: "/admin/settings", label: "Ajustes", icon: "shield" },
];

const ROLE_LABEL = { ADMIN: "Administrador", REFEREE: "Árbitro" };
const STAGE_LABEL = { GROUP: "Grupos", PLAYOFF: "Playoff" };
const KIND_LABEL = { LIGA: "Liga", TORNEO: "Torneo", COPA: "Copa" };
const KIND_BADGE = { LIGA: "pill-live", TORNEO: "", COPA: "pill-muted" };

function flash(query) {
  if (query.ok) return html`<div class="alert alert-success">${query.ok}</div>`;
  if (query.err) return html`<div class="alert alert-error">${query.err}</div>`;
  return html``;
}

export function adminPage(scope, { title, subtitle = "", body, active = "dashboard", user, query = {}, actions = "", scripts = [] }) {
  const css = `:root{--primary:${scope.theme.primary};--secondary:${scope.theme.secondary};--background:${scope.theme.background};--accent:${scope.theme.accent};--text:${scope.theme.text};--text-secondary:${scope.theme.textSecondary};}`;
  return html`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · Admin · ${scope.org.name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" /><style>${raw(css)}</style>
</head>
<body class="admin-body">
<div class="admin-shell">
  <aside class="admin-side">
    <a class="admin-brand" href="/admin">
      ${scope.org.logo_url ? html`<img src="${scope.org.logo_url}" alt="" />` : ""}
      <span>${scope.org.name}<small>Consola de la liga</small></span>
    </a>
    <nav class="admin-nav">
      ${NAV.map((n) => html`<a class="admin-link${active === n.key ? " is-active" : ""}" href="${n.href}">${icons[n.icon]({ size: 18 })}<span>${n.label}</span></a>`)}
    </nav>
    <div class="admin-side-foot">
      <a class="admin-link" href="/es" target="_blank">${icons.arrow({ size: 18 })}<span>Ver el sitio de la liga</span></a>
      <div class="admin-user">
        <span class="avatar avatar--empty">${(user?.name || "A")[0]}</span>
        <span>${user?.name || user?.email || ""}<small>${ROLE_LABEL[user?.role] || user?.role || ""}</small></span>
      </div>
      <form method="post" action="/admin/logout"><button class="btn btn-ghost btn-block" type="submit">Cerrar sesión</button></form>
    </div>
  </aside>
  <div class="admin-main">
    <header class="admin-top">
      <div><h1>${title}</h1>${subtitle ? html`<p class="muted">${subtitle}</p>` : ""}</div>
      <div class="admin-top-actions">${actions}</div>
    </header>
    <div class="admin-content">
      ${flash(query)}
      ${body}
    </div>
  </div>
</div>
${scripts.map((s) => html`<script src="${s}" defer></script>`)}
</body></html>`;
}

/* ------------------------------------------------------------------- login */

export function loginView(scope, { error = "" } = {}) {
  const css = `:root{--primary:${scope.theme.primary};--secondary:${scope.theme.secondary};--background:${scope.theme.background};--accent:${scope.theme.accent};--text:${scope.theme.text};--text-secondary:${scope.theme.textSecondary};}`;
  return html`<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Iniciar sesión · ${scope.org.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/styles.css" /><style>${raw(css)}</style></head>
<body class="auth-body">
  <div class="auth-card">
    <div class="auth-brand">
      ${scope.org.logo_url ? html`<img src="${scope.org.logo_url}" alt="" />` : ""}
      <h1>${scope.org.name}</h1>
      <p class="muted">Consola de gestión de la liga</p>
    </div>
    ${error ? html`<div class="alert alert-error">${error}</div>` : ""}
    <form method="post" action="/admin/login" class="form">
      <label>Correo electrónico<input type="email" name="email" autocomplete="username" required /></label>
      <label>Contraseña<input type="password" name="password" autocomplete="current-password" required /></label>
      <button class="btn btn-primary btn-block" type="submit">Entrar</button>
    </form>
    <p class="auth-back"><a href="/es">← Volver al sitio de la liga</a></p>
  </div>
</body></html>`;
}

/* --------------------------------------------------------------- dashboard */

export function dashboardView(scope, data) {
  const { counts, recent, upcoming } = data;
  const body = html`
    <div class="kpi-grid">
      ${[
        ["Equipos", counts.teams, "/admin/teams"],
        ["Jugadores", counts.players, "/admin/players"],
        ["Partidos", counts.games, "/admin/games"],
        ["Goles", counts.goals, "/admin/games"],
        ["Pendientes", counts.upcoming, "/admin/games?status=NOT_STARTED"],
      ].map(([label, value, href]) => html`<a class="kpi" href="${href}"><span class="kpi-value">${value}</span><span class="kpi-label">${label}</span></a>`)}
    </div>

    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Resultados recientes</h2><a class="link-more" href="/admin/games">Todos los partidos</a></div>
        <table class="data-table compact"><tbody>
          ${recent.map((g) => html`<tr>
            <td class="muted nowrap">${fmtDate(g.game_date, scope.theme.timezone)}</td>
            <td>${g.home_name}</td><td class="num strong">${g.score_home ?? "—"} : ${g.score_away ?? "—"}</td><td>${g.away_name}</td>
            <td class="num"><a class="btn btn-mini" href="/admin/games/${g.id}">Editar</a></td>
          </tr>`)}
        </tbody></table>
      </section>
      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Próximos partidos</h2><a class="link-more" href="/admin/games">Todos los partidos</a></div>
        <table class="data-table compact"><tbody>
          ${upcoming.map((g) => html`<tr>
            <td class="muted nowrap">${fmtDateTime(g.game_date, scope.theme.timezone)}</td>
            <td>${g.home_name}</td><td class="muted">vs</td><td>${g.away_name}</td>
            <td class="num"><a class="btn btn-mini" href="/admin/games/${g.id}">Abrir</a></td>
          </tr>`)}
        </tbody></table>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h2 class="panel-title">Acciones rápidas</h2></div>
      <div class="quick-actions">
        <a class="quick" href="/admin/competitions/new">${icons.trophy({ size: 22 })}<span>Crear una competición</span></a>
        <a class="quick" href="/admin/games/new">${icons.ball({ size: 22 })}<span>Programar un partido</span></a>
        <a class="quick" href="/admin/teams/new">${icons.plus({ size: 22 })}<span>Añadir un equipo</span></a>
        <a class="quick" href="/referee">${icons.whistle({ size: 22 })}<span>Abrir la app de árbitro</span></a>
      </div>
    </section>`;
  return adminPage(scope, { title: "Panel", subtitle: `${scope.org.name} · ${scope.theme.timezone}`, body, active: "dashboard", user: data.user });
}

/* ------------------------------------------------------------------- teams */

export function teamsView(scope, { teams, user, query }) {
  const body = html`
    <section class="panel">
      <div class="panel-head"><h2 class="panel-title">Equipos</h2><a class="btn btn-primary" href="/admin/teams/new">${icons.plus({ size: 16 })} Añadir equipo</a></div>
      <table class="data-table">
        <thead><tr><th>Equipo</th><th>Slug</th><th>Ciudad</th><th class="num">Jugadores</th><th class="num">Competiciones</th><th class="num">Acciones</th></tr></thead>
        <tbody>${teams.map((t) => html`<tr>
          <td><span class="team-cell">${crest(t.crest_url, t.name)}<span>${t.name}</span></span></td>
          <td class="muted"><code>${t.slug}</code></td>
          <td class="muted">${t.city || "—"}</td>
          <td class="num">${t.players}</td>
          <td class="num">${t.competitions}</td>
          <td class="num row-actions">
            <a class="btn btn-mini" href="/admin/teams/${t.id}">Editar</a>
            <form method="post" action="/admin/teams/${t.id}/delete" onsubmit="return confirm('¿Eliminar este equipo?')">
              <button class="btn btn-mini btn-danger" type="submit">Eliminar</button>
            </form>
          </td>
        </tr>`)}</tbody>
      </table>
    </section>`;
  return adminPage(scope, { title: "Equipos", subtitle: "Gestiona clubes, escudos y participación en competiciones", body, active: "teams", user, query });
}

export function teamFormView(scope, { team, competitions, user, query }) {
  const t = team || {};
  const body = html`<section class="panel form-panel">
    <form method="post" action="/admin/teams/save" class="form">
      ${t.id ? html`<input type="hidden" name="id" value="${t.id}" />` : ""}
      <div class="field-row">
        <label>Nombre<input name="name" required value="${t.name || ""}" /></label>
        <label>Nombre corto<input name="name_short" maxlength="5" value="${t.name_short || ""}" /></label>
      </div>
      <div class="field-row">
        <label>Slug<input name="slug" value="${t.slug || ""}" placeholder="generado a partir del nombre" /></label>
        <label>Ciudad<input name="city" value="${t.city || ""}" /></label>
      </div>
      <label>URL del escudo<input name="crest_url" value="${t.crest_url || ""}" /></label>
      <label>Descripción<textarea name="about" rows="4">${t.about || ""}</textarea></label>
      <fieldset class="fieldset">
        <legend>Participación en competiciones</legend>
        <div class="checkbox-grid">
          ${competitions.map((c) => html`<label class="checkbox"><input type="checkbox" name="competitions" value="${c.id}"${c.selected ? " checked" : ""}/> <span>${c.name}</span></label>`)}
        </div>
      </fieldset>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">Guardar equipo</button>
        <a class="btn btn-ghost" href="/admin/teams">Cancelar</a>
      </div>
    </form>
  </section>`;
  return adminPage(scope, { title: t.id ? `Editar ${t.name}` : "Nuevo equipo", body, active: "teams", user, query });
}

/* ----------------------------------------------------------------- players */

export function adminPlayersView(scope, { players, teams, q, teamId, user, query }) {
  const body = html`
    <section class="panel">
      <div class="panel-head">
        <form class="list-filter" method="get" action="/admin/players">
          <input type="search" name="q" value="${q || ""}" placeholder="Buscar jugador" />
          <select name="team" onchange="this.form.submit()">
            <option value="">Todos los equipos</option>
            ${teams.map((t) => html`<option value="${t.id}"${String(teamId) === String(t.id) ? " selected" : ""}>${t.name}</option>`)}
          </select>
          <button class="btn btn-ghost" type="submit">Filtrar</button>
        </form>
        <a class="btn btn-primary" href="/admin/players/new">${icons.plus({ size: 16 })} Añadir jugador</a>
      </div>
      <table class="data-table">
        <thead><tr><th>Jugador</th><th>Equipo</th><th class="num">#</th><th>Nacimiento</th><th class="num">Acciones</th></tr></thead>
        <tbody>${players.map((p) => html`<tr>
          <td><span class="player-cell">${p.avatar_url ? html`<img class="avatar" src="${p.avatar_url}" alt="" />` : html`<span class="avatar avatar--empty">${(p.first_name?.[0] || "") + (p.last_name?.[0] || "")}</span>`}<span>${p.full_name}</span></span></td>
          <td class="muted">${p.team_name || "—"}</td>
          <td class="num">${p.squad_number ?? "—"}</td>
          <td class="muted">${p.date_of_birth || "—"}</td>
          <td class="num row-actions">
            <a class="btn btn-mini" href="/admin/players/${p.id}">Editar</a>
            <form method="post" action="/admin/players/${p.id}/delete" onsubmit="return confirm('¿Eliminar este jugador?')">
              <button class="btn btn-mini btn-danger" type="submit">Eliminar</button>
            </form>
          </td>
        </tr>`)}</tbody>
      </table>
      <p class="table-note">${players.length} jugadores mostrados.</p>
    </section>`;
  return adminPage(scope, { title: "Jugadores", subtitle: "Plantillas, dorsales y perfiles de jugadores", body, active: "players", user, query });
}

export function adminPlayerFormView(scope, { player, teams, user, query }) {
  const p = player || {};
  return adminPage(scope, {
    title: p.id ? `Editar ${p.first_name} ${p.last_name}` : "Nuevo jugador",
    active: "players", user, query,
    body: html`<section class="panel form-panel">
      <form method="post" action="/admin/players/save" class="form">
        ${p.id ? html`<input type="hidden" name="id" value="${p.id}" />` : ""}
        <div class="field-row">
          <label>Nombre<input name="first_name" required value="${p.first_name || ""}" /></label>
          <label>Apellidos<input name="last_name" required value="${p.last_name || ""}" /></label>
        </div>
        <div class="field-row">
          <label>Fecha de nacimiento<input type="date" name="date_of_birth" value="${p.date_of_birth || ""}" /></label>
          <label>URL del avatar<input name="avatar_url" value="${p.avatar_url || ""}" /></label>
        </div>
        <div class="field-row">
          <label>Equipo
            <select name="competition_team_id">
              <option value="">Sin asignar</option>
              ${teams.map((t) => html`<option value="${t.id}"${String(p.competition_team_id) === String(t.id) ? " selected" : ""}>${t.name}${t.competition ? ` · ${t.competition}` : ""}</option>`)}
            </select>
          </label>
          <label>Dorsal<input type="number" name="squad_number" min="1" max="99" value="${p.squad_number ?? ""}" /></label>
        </div>
        <label>Descripción<textarea name="about" rows="3">${p.about || ""}</textarea></label>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">Guardar jugador</button>
          <a class="btn btn-ghost" href="/admin/players">Cancelar</a>
        </div>
      </form>
    </section>`,
  });
}

/* ------------------------------------------------------------ competitions */

export function competitionsView(scope, { competitions, user, query }) {
  const body = html`
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Competiciones</h2>
        <a class="btn btn-primary" href="/admin/competitions/new">${icons.plus({ size: 16 })} Nueva competición</a>
      </div>
      ${competitions.length === 0
        ? html`<p class="muted">Aún no hay competiciones. Crea la primera para empezar.</p>`
        : html`<table class="data-table">
        <thead><tr><th>Competición</th><th>Modelo</th><th>Temporada</th><th class="num">Equipos</th><th class="num">Grupos</th><th class="num">Jornadas</th><th class="num">Partidos</th><th>Estado</th><th class="num">Acciones</th></tr></thead>
        <tbody>${competitions.map((c) => html`<tr>
          <td><strong>${c.name}</strong><br /><span class="muted small"><code>${c.slug || "—"}</code></span></td>
          <td><span class="pill ${KIND_BADGE[c.kind] || ""}">${KIND_LABEL[c.kind] || c.kind || "—"}</span></td>
          <td class="muted">${c.season_name || "—"}</td>
          <td class="num">${c.teams}</td>
          <td class="num">${c.groups_count}</td>
          <td class="num">${c.group_rounds} + ${c.playoff_rounds}</td>
          <td class="num">${c.games}</td>
          <td>${c.is_archive ? html`<span class="pill pill-muted">Archivada</span>` : html`<span class="pill pill-live">Publicada</span>`}</td>
          <td class="num row-actions">
            <a class="btn btn-mini" href="/admin/competitions/${c.id}">Gestionar</a>
            <a class="btn btn-mini" href="/${scope.lang}/competition/${c.slug}" target="_blank" rel="noopener">Ver</a>
          </td>
        </tr>`)}</tbody>
      </table>`}
    </section>`;
  return adminPage(scope, { title: "Competiciones", subtitle: "Grupos, cruces y partidos bajo tu control", body, active: "competitions", user, query });
}

export function competitionFormView(scope, data) {
  const { competition: c, seasons = [], groups = [], rounds = [], teams = [], seeds = [], pitches = [], user, query } = data;
  const editing = Boolean(c && c.id);
  const comp = c || {
    name: "", slug: "", kind: "LIGA", season_id: null,
    start_date: "", end_date: "", location: "",
    points_win: 3, points_draw: 1, points_lose: 0,
    ranking_points: "DESC", ranking_goal_diff: "DESC", ranking_goals_scored: "DESC", ranking_wins: "DESC",
    half_time: 10, red_card_suspension_matches: 1, is_archive: 0, about: "", regulations: "",
  };
  const action = editing ? `/admin/competitions/${comp.id}/save` : "/admin/competitions/create";

  const settings = html`
    <section class="panel form-panel">
      <h2 class="panel-title">${editing ? "Ajustes de la competición" : "Nueva competición"}</h2>
      <form method="post" action="${action}" class="form">
        <div class="field-row">
          <label>Nombre<input name="name" required value="${comp.name || ""}" /></label>
          <label>Slug<input name="slug" value="${comp.slug || ""}" placeholder="generado a partir del nombre" /></label>
        </div>
        ${editing ? html`
        <div class="field-row">
          <label>Modelo
            <input value="${KIND_LABEL[comp.kind] || comp.kind || "Torneo"}" disabled />
            <input type="hidden" name="kind" value="${comp.kind || "TORNEO"}" />
          </label>
          <p class="muted small">El modelo define solo la estructura inicial; la puedes cambiar luego con grupos y jornadas.</p>
        </div>` : html`
        <div class="field-row">
          <label>Modelo
            <select name="kind" required>
              <option value="LIGA"${comp.kind === "LIGA" ? " selected" : ""}>Liga — un grupo, todos contra todos</option>
              <option value="TORNEO"${comp.kind === "TORNEO" ? " selected" : ""}>Torneo — fase de grupos + playoff</option>
              <option value="COPA"${comp.kind === "COPA" ? " selected" : ""}>Copa — solo eliminatorias</option>
            </select>
          </label>
          <p class="muted small">Estructura inicial que se crea automáticamente al guardar.</p>
        </div>`}
        <div class="field-row">
          <label>Temporada
            <select name="season_id">
              <option value="">Sin temporada</option>
              ${seasons.map((s) => html`<option value="${s.id}"${String(comp.season_id) === String(s.id) ? " selected" : ""}>${s.name}</option>`)}
            </select>
          </label>
          <label>Duración de cada parte (min)<input type="number" name="half_time" min="1" max="60" value="${comp.half_time ?? 10}" /></label>
        </div>
        <div class="field-row three">
          <label>Fecha de inicio<input type="date" name="start_date" value="${comp.start_date || ""}" /></label>
          <label>Fecha de fin<input type="date" name="end_date" value="${comp.end_date || ""}" /></label>
          <label>Ubicación<input name="location" value="${comp.location || ""}" placeholder="Pabellón municipal" /></label>
        </div>
        <fieldset class="fieldset">
          <legend>Puntos por resultado</legend>
          <div class="field-row three">
            <label>Victoria<input type="number" name="points_win" value="${comp.points_win ?? 3}" /></label>
            <label>Empate<input type="number" name="points_draw" value="${comp.points_draw ?? 1}" /></label>
            <label>Derrota<input type="number" name="points_lose" value="${comp.points_lose ?? 0}" /></label>
          </div>
        </fieldset>
        <fieldset class="fieldset">
          <legend>Desempates (orden: puntos, diferencia de goles, goles a favor, victorias)</legend>
          <div class="field-row three">
            <label>Puntos
              <select name="ranking_points"><option value="DESC"${comp.ranking_points === "DESC" ? " selected" : ""}>Mayor primero</option><option value="ASC"${comp.ranking_points === "ASC" ? " selected" : ""}>Menor primero</option></select>
            </label>
            <label>Diferencia de goles
              <select name="ranking_goal_diff"><option value="DESC"${comp.ranking_goal_diff === "DESC" ? " selected" : ""}>Mayor primero</option><option value="ASC"${comp.ranking_goal_diff === "ASC" ? " selected" : ""}>Menor primero</option></select>
            </label>
            <label>Goles a favor
              <select name="ranking_goals_scored"><option value="DESC"${comp.ranking_goals_scored === "DESC" ? " selected" : ""}>Mayor primero</option><option value="ASC"${comp.ranking_goals_scored === "ASC" ? " selected" : ""}>Menor primero</option></select>
            </label>
          </div>
        </fieldset>
        <div class="field-row">
          <label>Suspensión por tarjeta roja (partidos)<input type="number" name="red_card_matches" min="0" value="${comp.red_card_suspension_matches ?? 0}" /></label>
          <label class="checkbox-line"><input type="checkbox" name="is_archive"${comp.is_archive ? " checked" : ""}/> Temporada archivada</label>
        </div>
        <label>Descripción<textarea name="about" rows="3">${comp.about || ""}</textarea></label>
        <label>Reglamento<textarea name="regulations" rows="5">${comp.regulations || ""}</textarea></label>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">${editing ? "Guardar ajustes" : "Crear competición"}</button>
          <a class="btn btn-ghost" href="/admin/competitions">Cancelar</a>
        </div>
      </form>
    </section>`;

  if (!editing) {
    return adminPage(scope, { title: "Nueva competición", body: settings, active: "competitions", user, query });
  }

  const groupsPanel = html`
    <section class="panel">
      <div class="panel-head"><h2 class="panel-title">Grupos</h2><span class="muted small">Cada grupo tiene su propia tabla</span></div>
      ${groups.length === 0
        ? html`<p class="muted">Sin grupos. Añade al menos uno para la fase de grupos.</p>`
        : html`<table class="data-table">
        <thead><tr><th>Grupo</th><th class="num">Equipos</th><th class="num">Acciones</th></tr></thead>
        <tbody>${groups.map((g) => html`<tr>
          <td>
            <form method="post" action="/admin/competitions/${comp.id}/groups/save" class="inline-form">
              <input type="hidden" name="id" value="${g.id}" />
              <input name="name" value="${g.name}" aria-label="Nombre del grupo" />
              <input type="number" name="ordering" value="${g.ordering ?? 0}" class="input-num" aria-label="Orden" />
              <button class="btn btn-mini" type="submit">Guardar</button>
            </form>
          </td>
          <td class="num">${g.teams}</td>
          <td class="num row-actions">
            <form method="post" action="/admin/competitions/${comp.id}/groups/${g.id}/delete" onsubmit="return confirm('¿Eliminar este grupo? Solo si no tiene equipos ni jornadas.')">
              <button class="btn btn-mini btn-danger" type="submit">Eliminar</button>
            </form>
          </td>
        </tr>`)}</tbody>
      </table>`}
      <form method="post" action="/admin/competitions/${comp.id}/groups/save" class="form inline-form">
        <label>Nuevo grupo<input name="name" placeholder="Grupo A" required /></label>
        <label>Orden<input type="number" name="ordering" value="${groups.length + 1}" class="input-num" /></label>
        <button class="btn btn-primary" type="submit">Añadir grupo</button>
      </form>
    </section>`;

  const teamsPanel = html`
    <section class="panel">
      <div class="panel-head"><h2 class="panel-title">Equipos y grupos</h2><span class="muted small">Marca quién participa y asígnale grupo</span></div>
      ${teams.length === 0
        ? html`<p class="muted">No hay equipos creados. Añádelos primero en <a href="/admin/teams">Equipos</a>.</p>`
        : html`<form method="post" action="/admin/competitions/${comp.id}/teams/save" class="form">
        <table class="data-table">
          <thead><tr><th>Participa</th><th>Equipo</th><th>Grupo</th></tr></thead>
          <tbody>${teams.map((t) => html`<tr>
            <td><input type="checkbox" name="teams" value="${t.id}"${t.in_competition ? " checked" : ""}/></td>
            <td>${t.name}</td>
            <td>${groups.length === 0
              ? html`<span class="muted">Sin grupos</span>`
              : html`<select name="group_${t.id}"><option value="">Sin grupo</option>${groups.map((g) => html`<option value="${g.id}"${String(t.group_id) === String(g.id) ? " selected" : ""}>${g.name}</option>`)}</select>`}</td>
          </tr>`)}</tbody>
        </table>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Guardar equipos</button></div>
      </form>`}
    </section>`;

  const roundsPanel = html`
    <section class="panel">
      <div class="panel-head"><h2 class="panel-title">Jornadas</h2><span class="muted small">Jornadas de grupos y rondas de playoff</span></div>
      ${rounds.length === 0
        ? html`<p class="muted">Sin jornadas. Crea la primera para poder programar partidos.</p>`
        : html`<table class="data-table">
        <thead><tr><th>Jornada</th><th>Fase</th><th>Grupo</th><th class="num">Partidos</th><th class="num">Orden</th><th class="num">Acciones</th></tr></thead>
        <tbody>${rounds.map((r) => html`<tr>
          <td>${r.name}</td>
          <td><span class="pill">${STAGE_LABEL[r.stage] || r.stage}</span></td>
          <td class="muted">${r.group_name || "—"}</td>
          <td class="num">${r.games}</td>
          <td class="num">${r.ordering ?? 0}</td>
          <td class="num row-actions">
            <a class="btn btn-mini" href="/admin/games?competition=${comp.id}&round=${r.id}">Partidos</a>
            <form method="post" action="/admin/competitions/${comp.id}/rounds/${r.id}/delete" onsubmit="return confirm('¿Eliminar esta jornada? Solo si no tiene partidos.')">
              <button class="btn btn-mini btn-danger" type="submit">Eliminar</button>
            </form>
          </td>
        </tr>`)}</tbody>
      </table>`}
      <form method="post" action="/admin/competitions/${comp.id}/rounds/save" class="form">
        <div class="field-row three">
          <label>Nombre<input name="name" placeholder="Jornada 1" required /></label>
          <label>Fase
            <select name="stage">
              <option value="GROUP">Grupos</option>
              <option value="PLAYOFF">Playoff</option>
            </select>
          </label>
          <label>Grupo
            <select name="group_id">
              <option value="">—</option>
              ${groups.map((g) => html`<option value="${g.id}">${g.name}</option>`)}
            </select>
          </label>
        </div>
        <label>Orden<input type="number" name="ordering" value="${rounds.length + 1}" class="input-num" /></label>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Añadir jornada</button></div>
      </form>
    </section>`;

  const playoffRounds = rounds.filter((r) => r.stage === "PLAYOFF");
  const qualifiedCount = seeds.filter((s) => s.qualified).length;

  const fixturesPanel = html`
    <section class="panel">
      <div class="panel-head"><h2 class="panel-title">Sorteo, horarios y cruces</h2><span class="muted small">Automatiza la fase de grupos y el playoff</span></div>

      <h3 class="panel-subtitle">Sorteo de la fase de grupos</h3>
      <form method="post" action="/admin/competitions/${comp.id}/fixtures/generate" class="form">
        <label class="checkbox-line"><input type="checkbox" name="double" /> Ida y vuelta (cada equipo juega dos veces contra cada rival)</label>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit" name="group_id" value="">${groups.length ? "Sortear todos los grupos" : "Sortear la liga"}</button>
          ${groups.map((g) => html`<button class="btn btn-ghost" type="submit" name="group_id" value="${g.id}">Solo ${g.name}</button>`)}
        </div>
        <p class="muted small">Emparejamientos al azar: cada equipo se enfrenta a todos sus rivales. Solo sustituye los partidos pendientes; los ya jugados se conservan.</p>
      </form>

      <h3 class="panel-subtitle">Horarios automáticos</h3>
      <form method="post" action="/admin/competitions/${comp.id}/fixtures/schedule" class="form">
        <div class="field-row three">
          <label>Empieza el<input type="date" name="start_date" value="${comp.start_date || ""}" required /></label>
          <label>Primera hora<input type="time" name="from_time" value="18:00" /></label>
          <label>Última hora<input type="time" name="to_time" value="23:00" /></label>
        </div>
        <div class="field-row three">
          <label>Minutos por partido<input type="number" name="slot_minutes" min="15" value="${(comp.half_time ?? 10) * 2 + 15}" /></label>
          <label>Partidos por equipo al día<input type="number" name="max_per_day" min="1" max="4" value="1" /></label>
        </div>
        ${pitches.length === 0
          ? html`<p class="muted">Sin canchas: los partidos se programan sin cancha asignada.</p>`
          : html`<fieldset class="fieldset">
          <legend>Canchas disponibles</legend>
          <div class="field-row">${pitches.map((pt) => html`<label class="checkbox-line"><input type="checkbox" name="pitches" value="${pt.id}" checked /> ${pt.name}</label>`)}</div>
        </fieldset>`}
        <div class="form-actions"><button class="btn btn-primary" type="submit">Asignar fechas y canchas</button></div>
        <p class="muted small">Coloca los partidos sin fecha evitando que un equipo juegue dos veces el mismo día y sin solapar canchas. Luego puedes ajustar cualquier partido a mano desde <a href="/admin/games?competition=${comp.id}">Partidos y resultados</a>.</p>
      </form>

      <h3 class="panel-subtitle">Canchas</h3>
      ${pitches.length === 0 ? "" : html`<table class="data-table">
        <tbody>${pitches.map((pt) => html`<tr>
          <td>${pt.name}</td>
          <td class="muted">${pt.address || "—"}</td>
          <td class="num row-actions">
            <form method="post" action="/admin/pitches/${pt.id}/delete">
              <input type="hidden" name="back" value="/admin/competitions/${comp.id}" />
              <button class="btn btn-mini btn-danger" type="submit">Eliminar</button>
            </form>
          </td>
        </tr>`)}</tbody>
      </table>`}
      <form method="post" action="/admin/pitches/save" class="form inline-form">
        <input type="hidden" name="back" value="/admin/competitions/${comp.id}" />
        <label>Nueva cancha<input name="name" placeholder="Cancha 1" required /></label>
        <label>Dirección<input name="address" placeholder="opcional" /></label>
        <button class="btn btn-primary" type="submit">Añadir cancha</button>
      </form>

      ${seeds.length === 0 ? "" : html`
      <h3 class="panel-subtitle">Clasificación para el playoff</h3>
      <table class="data-table">
        <thead><tr><th class="num">#</th><th>Equipo</th><th>Grupo</th><th class="num">Puesto</th><th class="num">Pts aj.</th><th class="num">DG</th><th></th></tr></thead>
        <tbody>${seeds.map((s) => html`<tr>
          <td class="num">${s.seed}</td>
          <td>${s.team_name}</td>
          <td class="muted">${s.group_name || "—"}</td>
          <td class="num">${s.place}º</td>
          <td class="num">${s.points}</td>
          <td class="num">${s.goals_diff}</td>
          <td>${s.groupWinner ? html`<span class="pill">Clasificado</span>` : s.bestRunnerUp ? html`<span class="pill">Mejor 2.º</span>` : ""}</td>
        </tr>`)}</tbody>
      </table>
      <p class="muted small">Los puntos ajustados comparan grupos de distinto tamaño contando solo los partidos contra los mejores de cada grupo. Clasifican ${qualifiedCount} equipos: campeones de grupo más el mejor segundo.</p>`}

      <h3 class="panel-subtitle">Cruces del playoff</h3>
      ${playoffRounds.length === 0
        ? html`<p class="muted">Crea arriba una jornada con fase «Playoff» para generar los cruces.</p>`
        : html`<div class="form-actions">
        ${playoffRounds.map((r) => html`
          <form method="post" action="/admin/competitions/${comp.id}/bracket/seed">
            <input type="hidden" name="round_id" value="${r.id}" />
            <button class="btn btn-primary" type="submit"${r.games > 0 ? " disabled" : ""}>Sembrar «${r.name}»</button>
          </form>`)}
      </div>
      <p class="muted small">Empareja al mejor clasificado con el peor (1.º contra último, 2.º contra penúltimo…). La primera ronda toma los clasificados de la fase de grupos; las siguientes, a los ganadores de la ronda anterior.</p>`}
    </section>`;

  const body = html`
    ${settings}
    <div class="two-col">
      ${groupsPanel}
      ${teamsPanel}
    </div>
    ${roundsPanel}
    ${fixturesPanel}
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Partidos</h2>
        <a class="btn btn-primary" href="/admin/games/new?competition=${comp.id}">${icons.plus({ size: 16 })} Programar partido</a>
      </div>
      <p class="muted">Los partidos se programan uno a uno eligiendo jornada y equipos. Puedes ordenarlos y editarlos desde <a href="/admin/games?competition=${comp.id}">Partidos y resultados</a>.</p>
      <form method="post" action="/admin/competitions/${comp.id}/delete" onsubmit="return confirm('¿Eliminar la competición con sus grupos, jornadas y partidos?')">
        <button class="btn btn-danger" type="submit">Eliminar competición</button>
      </form>
    </section>`;

  return adminPage(scope, { title: comp.name, subtitle: comp.season_name || "Competición", body, active: "competitions", user, query });
}

/* ------------------------------------------------------------------- games */

export function adminGamesView(scope, { games, competitions, competitionId, status, stage, roundId, rounds, user, query }) {
  const tz = scope.theme.timezone;
  const createHref = competitionId ? `/admin/games/new?competition=${competitionId}` : "/admin/games/new";
  return adminPage(scope, {
    title: "Partidos y resultados", subtitle: "Programa, ordena y edita cada partido", active: "games", user, query,
    actions: html`<a class="btn btn-primary" href="${createHref}">${icons.plus({ size: 16 })} Programar partido</a>`,
    body: html`<section class="panel">
      <div class="panel-head">
        <form class="list-filter" method="get" action="/admin/games">
          <select name="competition" onchange="this.form.submit()">
            <option value="">Todas las competiciones</option>
            ${competitions.map((c) => html`<option value="${c.id}"${String(competitionId) === String(c.id) ? " selected" : ""}>${c.name}</option>`)}
          </select>
          <select name="stage" onchange="this.form.submit()">
            <option value="">Todas las fases</option>
            ${["GROUP", "PLAYOFF"].map((s) => html`<option value="${s}"${stage === s ? " selected" : ""}>${STAGE_LABEL[s]}</option>`)}
          </select>
          <select name="round" onchange="this.form.submit()">
            <option value="">Todas las jornadas</option>
            ${rounds.map((r) => html`<option value="${r.id}"${String(roundId) === String(r.id) ? " selected" : ""}>${r.name}</option>`)}
          </select>
          <select name="status" onchange="this.form.submit()">
            ${["", "NOT_STARTED", "STARTED", "BREAK", "FINISHED", "CANCELED"].map((s) => html`<option value="${s}"${status === s ? " selected" : ""}>${s ? statusLabel(s) : "Todos los estados"}</option>`)}
          </select>
        </form>
        <a class="btn btn-ghost" href="/referee">Abrir la app de árbitro</a>
      </div>
      ${games.length === 0 ? html`<p class="muted">No hay partidos con estos filtros.</p>` : html`<table class="data-table">
        <thead><tr><th>Fecha</th><th>Competición</th><th>Jornada</th><th>Partido</th><th class="center">Marcador</th><th>Estado</th><th class="num">Acciones</th></tr></thead>
        <tbody>${games.map((g) => html`<tr>
          <td class="muted nowrap">${fmtDateTime(g.game_date, tz)}</td>
          <td class="muted small">${g.competition_name}</td>
          <td class="muted small">${g.round_name || "—"}</td>
          <td>${g.home_name} <span class="muted">vs</span> ${g.away_name}</td>
          <td class="center score-cell">${g.score_home !== null && g.score_home !== undefined && g.score_away !== null && g.score_away !== undefined ? `${g.score_home} - ${g.score_away}` : "—"}</td>
          <td><span class="pill ${g.status === "FINISHED" ? "pill-muted" : g.status === "STARTED" ? "pill-live" : ""}">${statusLabel(g.status)}</span></td>
          <td class="num"><a class="btn btn-mini" href="/admin/games/${g.id}">Editar</a></td>
        </tr>`)}</tbody>
      </table>`}
    </section>`,
  });
}

export function adminGameFormView(scope, { competitions, competitionId, rounds, teams, pitches, user, query }) {
  const ready = competitionId && rounds.length && teams.length >= 2;
  return adminPage(scope, {
    title: "Programar partido", subtitle: "Elige jornada, equipos, fecha y sede", active: "games", user, query,
    body: html`
      <section class="panel">
        <form class="list-filter" method="get" action="/admin/games/new">
          <label>Competición
            <select name="competition" onchange="this.form.submit()">
              ${competitions.map((c) => html`<option value="${c.id}"${String(competitionId) === String(c.id) ? " selected" : ""}>${c.name}</option>`)}
            </select>
          </label>
        </form>
      </section>
      <section class="panel form-panel">
        ${!competitionId
          ? html`<p class="muted">Crea primero una competición desde <a href="/admin/competitions">Competiciones</a>.</p>`
          : rounds.length === 0
            ? html`<p class="muted">Esta competición no tiene jornadas. Añádelas desde <a href="/admin/competitions/${competitionId}">la competición</a>.</p>`
            : teams.length < 2
              ? html`<p class="muted">Necesitas al menos dos equipos en la competición. Asígnalos desde <a href="/admin/competitions/${competitionId}">la competición</a>.</p>`
              : ""}
        ${ready ? html`<form method="post" action="/admin/games/create" class="form">
          <input type="hidden" name="competition_id" value="${competitionId}" />
          <div class="field-row">
            <label>Jornada
              <select name="round_id" required>
                ${rounds.map((r) => html`<option value="${r.id}">${r.name} · ${STAGE_LABEL[r.stage] || r.stage}${r.group_name ? ` (${r.group_name})` : ""}</option>`)}
              </select>
            </label>
            <label>Código<input name="code" placeholder="opcional" /></label>
          </div>
          <div class="field-row">
            <label>Equipo local
              <select name="home_ct" required>${teams.map((t) => html`<option value="${t.competition_team_id}">${t.name}</option>`)}</select>
            </label>
            <label>Equipo visitante
              <select name="away_ct" required>${teams.map((t) => html`<option value="${t.competition_team_id}">${t.name}</option>`)}</select>
            </label>
          </div>
          <div class="field-row three">
            <label>Fecha<input type="date" name="date" /></label>
            <label>Hora<input type="time" name="time" /></label>
            <label>Cancha
              <select name="pitch_id"><option value="">—</option>${pitches.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select>
            </label>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Crear partido</button>
            <a class="btn btn-ghost" href="/admin/games">Cancelar</a>
          </div>
        </form>` : ""}
      </section>`,
  });
}

export function adminGameEditView(scope, data) {
  const { game, events, eventTypes, homePlayers, awayPlayers, rounds, teams, pitches, user, query } = data;
  const tz = scope.theme.timezone;
  const score = game.score_home !== null && game.score_away !== null ? `${game.score_home} - ${game.score_away}` : "0 - 0";
  const { date, time } = localParts(game.game_date, tz);
  const sides = [
    { ct: game.home_ct, name: game.home_name, players: homePlayers },
    { ct: game.away_ct, name: game.away_name, players: awayPlayers },
  ];
  return adminPage(scope, {
    title: "Editar partido", subtitle: `${game.home_name} vs ${game.away_name} · ${game.round_name || ""}`, active: "games", user, query,
    scripts: ["/referee.js", "/live.js"],
    body: html`
    <div data-live-game="${game.id}">
      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">Control en vivo</h2>
          <span class="pill ${game.status === "STARTED" ? "pill-live" : ""}" data-live="status">${statusLabel(game.status)}</span>
        </div>
        <div class="referee-score">
          <div class="referee-team">${crest(game.home_crest, game.home_name, "crest crest-lg")}<span>${game.home_name}</span></div>
          <div class="referee-score-centre">
            <div class="referee-score-value" id="live-score" data-live="score">${score}</div>
            <div class="referee-clock" id="match-clock" data-game="${game.id}">00:00</div>
          </div>
          <div class="referee-team">${crest(game.away_crest, game.away_name, "crest crest-lg")}<span>${game.away_name}</span></div>
        </div>
        <div class="referee-clock-row">
          <div class="referee-actions">
            <button class="btn btn-ghost" type="button" data-timer="start">Iniciar reloj</button>
            <button class="btn btn-ghost" type="button" data-timer="pause">Pausar</button>
            <button class="btn btn-ghost" type="button" data-timer="reset">Reiniciar</button>
          </div>
        </div>
        <div class="referee-actions status-actions">
          <form method="post" action="/admin/games/${game.id}/status" data-live-form><input type="hidden" name="status" value="STARTED" /><button class="btn btn-primary">Inicio / reanudar</button></form>
          <form method="post" action="/admin/games/${game.id}/status" data-live-form><input type="hidden" name="status" value="BREAK" /><button class="btn btn-ghost">Descanso</button></form>
          <form method="post" action="/admin/games/${game.id}/status" data-live-form><input type="hidden" name="status" value="FINISHED" /><button class="btn btn-dark" onclick="return confirm('¿Finalizar el partido?')">Final</button></form>
        </div>
        <p class="muted small">Los cambios se aplican sin recargar la página: el marcador y la lista de eventos se actualizan al instante. El reloj es local de este dispositivo y no cambia el estado por sí solo.</p>
      </section>

      <div class="two-col">
        <section class="panel form-panel">
          <h2 class="panel-title">Registrar evento</h2>
          <form method="post" action="/admin/games/${game.id}/events" class="referee-event-form" data-live-form>
            <div class="event-team-tabs">
              ${sides.map((team) => html`<fieldset class="event-team">
                <legend>${team.name}</legend>
                <div class="event-player-grid">
                  ${team.players.map((p) => html`<button class="event-player" type="submit" name="competition_player_id" value="${p.competition_player_id}">
                    <span class="event-player-num">${p.squad_number ?? "–"}</span>
                    <span class="event-player-name">${p.full_name}</span>
                    <span class="event-player-pos">${p.goals} goles${p.in_squad ? "" : " · sin convocar"}</span>
                  </button>`)}
                </div>
              </fieldset>`)}
            </div>
            <div class="event-type-row">
              <label>Evento
                <select name="event_type_id">
                  ${eventTypes.map((t) => html`<option value="${t.id}">${t.name}</option>`)}
                </select>
              </label>
              <label>Minuto<input type="number" name="time" id="event-minute" min="1" max="120" value="1" /></label>
              <p class="muted small">Pulsa el botón de un jugador para registrar el evento a su nombre. Los goles actualizan la clasificación.</p>
            </div>
          </form>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2 class="panel-title">Eventos del partido</h2>
            <span class="muted small" data-live="eventcount">${events.length} ${events.length === 1 ? "evento" : "eventos"}</span>
          </div>
          <div data-live="events" data-ssr="1">
            ${events.length === 0 ? html`<p class="muted">Sin eventos registrados.</p>` : html`
            <table class="data-table compact"><tbody>
              ${events.map((e) => html`<tr>
                <td class="num">${e.time}′</td>
                <td>${e.type_name}</td>
                <td>${e.player_name || "—"}</td>
                <td class="muted">${e.team_name || ""}</td>
                <td class="num row-actions"><form method="post" action="/admin/games/${game.id}/events/${e.id}/delete" data-live-form><button class="btn btn-mini btn-danger">Eliminar</button></form></td>
              </tr>`)}
            </tbody></table>`}
          </div>
        </section>
      </div>

      <section class="panel">
        <details>
          <summary class="panel-title">Convocatoria</summary>
          <form method="post" action="/admin/games/${game.id}/squad" class="form">
            <div class="two-col">
              ${sides.map((team) => html`<div>
                <h3 class="panel-subtitle">${team.name}</h3>
                <div class="squad-list">
                  ${team.players.map((p) => html`<label class="checkbox"><input type="checkbox" name="player" value="${p.competition_player_id}"${p.in_squad ? " checked" : ""}/> <span>${p.squad_number ? `#${p.squad_number} ` : ""}${p.full_name}</span></label>`)}
                </div>
              </div>`)}
            </div>
            <div class="form-actions"><button class="btn btn-primary" type="submit">Guardar convocatoria</button></div>
          </form>
        </details>
      </section>

      <section class="panel">
        <details>
          <summary class="panel-title">Resultado</summary>
          <form method="post" action="/admin/games/${game.id}/save" class="form">
            <div class="field-row three">
              <label>${game.home_name}<input type="number" name="score_home" min="0" value="${game.score_home ?? ""}" /></label>
              <label>${game.away_name}<input type="number" name="score_away" min="0" value="${game.score_away ?? ""}" /></label>
              <label>Estado
                <select name="status">
                  ${["NOT_STARTED", "STARTED", "BREAK", "FINISHED", "CANCELED"].map((s) => html`<option value="${s}"${game.status === s ? " selected" : ""}>${statusLabel(s)}</option>`)}
                </select>
              </label>
            </div>
            <div class="field-row">
              <label>Penaltis local<input type="number" name="penalty_score_home" min="0" value="${game.penalty_score_home ?? ""}" /></label>
              <label>Penaltis visitante<input type="number" name="penalty_score_away" min="0" value="${game.penalty_score_away ?? ""}" /></label>
            </div>
            <div class="form-actions"><button class="btn btn-primary" type="submit">Guardar resultado</button></div>
          </form>
        </details>
      </section>

      <section class="panel">
        <details>
          <summary class="panel-title">Reorganizar partido</summary>
          <p class="muted small">Cambia la jornada, los equipos, la fecha o la sede. Úsalo para ordenar cruces manualmente.</p>
          <form method="post" action="/admin/games/${game.id}/organize" class="form">
            <div class="field-row">
              <label>Jornada
                <select name="round_id">
                  ${rounds.map((r) => html`<option value="${r.id}"${String(game.round_id) === String(r.id) ? " selected" : ""}>${r.name} · ${STAGE_LABEL[r.stage] || r.stage}${r.group_name ? ` (${r.group_name})` : ""}</option>`)}
                </select>
              </label>
              <label>Código<input name="code" value="${game.code || ""}" /></label>
            </div>
            <div class="field-row">
              <label>Equipo local
                <select name="home_ct">${teams.map((t) => html`<option value="${t.competition_team_id}"${String(t.competition_team_id) === String(game.home_ct) ? " selected" : ""}>${t.name}</option>`)}</select>
              </label>
              <label>Equipo visitante
                <select name="away_ct">${teams.map((t) => html`<option value="${t.competition_team_id}"${String(t.competition_team_id) === String(game.away_ct) ? " selected" : ""}>${t.name}</option>`)}</select>
              </label>
            </div>
            <div class="field-row three">
              <label>Fecha<input type="date" name="date" value="${date}" /></label>
              <label>Hora<input type="time" name="time" value="${time}" /></label>
              <label>Cancha
                <select name="pitch_id"><option value="">—</option>${pitches.map((p) => html`<option value="${p.id}"${String(game.pitch_id) === String(p.id) ? " selected" : ""}>${p.name}</option>`)}</select>
              </label>
            </div>
            <div class="form-actions"><button class="btn btn-primary" type="submit">Guardar cambios</button></div>
          </form>
          <form method="post" action="/admin/games/${game.id}/delete" onsubmit="return confirm('¿Eliminar este partido y sus eventos?')">
            <button class="btn btn-danger" type="submit">Eliminar partido</button>
          </form>
        </details>
      </section>
    </div>`,
  });
}

/* ------------------------------------------------------------------ others */

export function sponsorsView(scope, { sponsors, user, query }) {
  const body = html`
    <section class="panel">
      <div class="panel-head"><h2 class="panel-title">Patrocinadores</h2><span class="muted small">Se muestran en la portada y el pie de página</span></div>
      ${sponsors.length === 0
        ? html`<p class="muted">Aún no hay patrocinadores. Añade el primero para empezar.</p>`
        : html`<table class="data-table">
        <thead><tr><th>Logo</th><th>Nombre</th><th>Enlace</th><th class="num">Orden</th><th>Activo</th><th class="num">Acciones</th></tr></thead>
        <tbody>${sponsors.map((s) => html`<tr>
          <td style="width:72px">
            ${s.logo_url
              ? html`<img src="${s.logo_url}" alt="" style="max-width:64px;max-height:40px;object-fit:contain" />`
              : html`<span class="muted small">Sin logo</span>`}
          </td>
          <td>
            <form method="post" action="/admin/sponsors/save" class="inline-form">
              <input type="hidden" name="id" value="${s.id}" />
              <input name="name" value="${s.name}" required aria-label="Nombre" />
          </td>
          <td>
              <input name="link_url" type="url" value="${s.link_url || ""}" placeholder="https://…" aria-label="Enlace" />
          </td>
          <td class="num">
              <input type="number" name="ordering" value="${s.ordering ?? 0}" class="input-num" aria-label="Orden" />
          </td>
          <td class="center">
              <input type="checkbox" name="active"${s.active ? " checked" : ""} aria-label="Activo" />
          </td>
          <td class="num row-actions">
              <input type="hidden" name="logo_url" value="${s.logo_url || ""}" />
              <button class="btn btn-mini" type="submit">Guardar</button>
            </form>
            <form method="post" action="/admin/sponsors/${s.id}/delete" onsubmit="return confirm('¿Eliminar este patrocinador?')">
              <button class="btn btn-mini btn-danger" type="submit">Eliminar</button>
            </form>
          </td>
        </tr>`)}</tbody>
      </table>`}
      <details class="details" ${sponsors.length === 0 ? "open" : ""}>
        <summary class="btn btn-primary">${icons.plus({ size: 16 })} Nuevo patrocinador</summary>
        <form method="post" action="/admin/sponsors/save" class="form" style="margin-top:12px">
          <div class="field-row">
            <label>Nombre<input name="name" required placeholder="Ej. Sportline" /></label>
            <label>Enlace<input name="link_url" type="url" placeholder="https://…" /></label>
          </div>
          <div class="field-row">
            <label>Logo URL<input name="logo_url" type="url" placeholder="https://…/logo.png" /></label>
            <label>Orden<input type="number" name="ordering" value="${(sponsors[sponsors.length - 1]?.ordering || 0) + 1}" class="input-num" /></label>
          </div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Añadir patrocinador</button></div>
        </form>
      </details>
    </section>`;
  return adminPage(scope, { title: "Patrocinadores", subtitle: "Se muestran en la portada y el pie de página", body, active: "sponsors", user, query });
}

export function settingsView(scope, { org, user, query }) {
  const socials = (() => { try { return JSON.parse(org.socials_json || "{}"); } catch { return {}; } })();
  return adminPage(scope, {
    title: "Ajustes", subtitle: "Identidad y colores de la liga", active: "settings", user, query,
    body: html`
      <section class="panel form-panel">
        <form method="post" action="/admin/settings/save" class="form">
          <div class="field-row">
            <label>Nombre de la liga<input name="name" value="${org.name}" /></label>
          </div>
          <div class="field-row three">
            <label>Color principal<input type="color" name="primary_color" value="${org.primary_color || "#006fff"}" /></label>
            <label>Color secundario<input type="color" name="secondary_color" value="${org.secondary_color || "#0500ff"}" /></label>
            <label>Color de acento<input type="color" name="background_accent_color" value="${org.background_accent_color || "#e1e9f4"}" /></label>
          </div>
          <div class="field-row three">
            <label>Facebook<input name="social_facebook_url" value="${socials.facebook || ""}" /></label>
            <label>Instagram<input name="social_instagram_url" value="${socials.instagram || ""}" /></label>
            <label>YouTube<input name="social_youtube_url" value="${socials.youtube || ""}" /></label>
          </div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Guardar ajustes</button></div>
        </form>
      </section>`,
  });
}

/* ----------------------------------------------------------------- referee */

export function refereeHomeView(scope, { games, user, today }) {
  const tz = scope.theme.timezone;
  const css = `:root{--primary:${scope.theme.primary};--secondary:${scope.theme.secondary};--background:${scope.theme.background};--accent:${scope.theme.accent};--text:${scope.theme.text};--text-secondary:${scope.theme.textSecondary};}`;
  return html`<!doctype html><html lang="es"><head><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" /><title>Árbitro · ${scope.org.name}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" /><style>${raw(css)}</style></head>
  <body class="referee-body">
    <header class="referee-top">
      <div class="referee-brand">${scope.org.logo_url ? html`<img src="${scope.org.logo_url}" alt="" />` : ""}<span>${scope.org.name}<small>App de árbitro</small></span></div>
      <div class="referee-user">
        <span>${user?.name || ""}</span>
        <form method="post" action="/admin/logout"><button class="btn btn-ghost btn-mini">Cerrar sesión</button></form>
      </div>
    </header>
    <main class="referee-main">
      <h1>${today ? "Partidos de hoy" : "Próximos partidos"}</h1>
      ${games.length === 0 ? html`<div class="empty-state"><p class="empty-title">Sin partidos asignados</p><p class="empty-hint">Pide al administrador que programe partidos.</p></div>` : ""}
      <div class="referee-games">
        ${games.map((g) => html`<a class="referee-game" href="/referee/game/${g.id}">
          <span class="referee-game-time">${fmtTime(g.game_date, tz)}<small>${fmtDate(g.game_date, tz)}</small></span>
          <span class="referee-game-teams">${g.home_name}<em>vs</em>${g.away_name}</span>
          <span class="pill ${g.status === "STARTED" ? "pill-live" : g.status === "FINISHED" ? "pill-muted" : ""}">${statusLabel(g.status)}</span>
          ${icons.arrow({ size: 20 })}
        </a>`)}
      </div>
    </main>
  </body></html>`;
}

export function refereeGameView(scope, data) {
  const { game, events, eventTypes, homePlayers, awayPlayers, user } = data;
  const tz = scope.theme.timezone;
  const css = `:root{--primary:${scope.theme.primary};--secondary:${scope.theme.secondary};--background:${scope.theme.background};--accent:${scope.theme.accent};--text:${scope.theme.text};--text-secondary:${scope.theme.textSecondary};}`;
  const score = game.score_home !== null && game.score_away !== null ? `${game.score_home} - ${game.score_away}` : "0 - 0";
  const phaseOrder = { goal: 0, own_goal: 0, assist: 1, yellow_card: 2, red_card: 3, mvp: 4 };
  return html`<!doctype html><html lang="es"><head><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" /><title>${game.home_name} vs ${game.away_name} · Árbitro</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" /><style>${raw(css)}</style></head>
  <body class="referee-body">
    <header class="referee-top">
      <a class="referee-brand" href="/referee">${scope.org.logo_url ? html`<img src="${scope.org.logo_url}" alt="" />` : ""}<span>${scope.org.name}<small>App de árbitro</small></span></a>
      <div class="referee-user"><span>${user?.name || ""}</span><form method="post" action="/admin/logout"><button class="btn btn-ghost btn-mini">Cerrar sesión</button></form></div>
    </header>
    <main class="referee-main">
      <div class="referee-match-head">
        <span class="muted">${game.round_name || ""} · ${fmtDateTime(game.game_date, tz)} · ${game.pitch_name || ""}</span>
      </div>
      <section class="referee-score panel">
        <div class="referee-team">${crest(game.home_crest, game.home_name, "crest crest-lg")}<span>${game.home_name}</span></div>
        <div class="referee-score-centre">
          <div class="referee-score-value" id="live-score">${score}</div>
          <div class="referee-clock" id="match-clock" data-game="${game.id}">00:00</div>
          <div class="referee-actions">
            <button class="btn btn-ghost" data-timer="start">Iniciar</button>
            <button class="btn btn-ghost" data-timer="pause">Pausar</button>
            <button class="btn btn-ghost" data-timer="reset">Reiniciar</button>
          </div>
        </div>
        <div class="referee-team">${crest(game.away_crest, game.away_name, "crest crest-lg")}<span>${game.away_name}</span></div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">Estado del partido</h2>
          <span class="pill ${game.status === "STARTED" ? "pill-live" : ""}">${statusLabel(game.status)}</span>
        </div>
        <div class="referee-actions">
          <form method="post" action="/referee/game/${game.id}/status"><input type="hidden" name="status" value="STARTED" /><button class="btn btn-primary">Inicio / reanudar</button></form>
          <form method="post" action="/referee/game/${game.id}/status"><input type="hidden" name="status" value="BREAK" /><button class="btn btn-ghost">Descanso</button></form>
          <form method="post" action="/referee/game/${game.id}/status"><input type="hidden" name="status" value="FINISHED" /><button class="btn btn-dark" onclick="return confirm('¿Finalizar el partido?')">Final</button></form>
        </div>
        <form method="post" action="/referee/game/${game.id}/score" class="form inline-form">
          <label>Local<input type="number" name="score_home" min="0" value="${game.score_home ?? 0}" /></label>
          <label>Visitante<input type="number" name="score_away" min="0" value="${game.score_away ?? 0}" /></label>
          <button class="btn btn-ghost">Corregir marcador</button>
        </form>
      </section>

      <section class="panel">
        <h2 class="panel-title">Registrar evento</h2>
        <form method="post" action="/referee/game/${game.id}/events" class="referee-event-form">
          <div class="event-team-tabs">
            ${[
              { ct: game.home_ct, name: game.home_name, players: homePlayers },
              { ct: game.away_ct, name: game.away_name, players: awayPlayers },
            ].map((team, i) => html`
            <fieldset class="event-team">
              <legend>${team.name}</legend>
              <div class="event-player-grid">
                ${team.players.map((p) => html`<button class="event-player" type="submit" name="submit" value="${team.ct}:${p.competition_player_id}" formaction="/referee/game/${game.id}/events">
                  <span class="event-player-num">${p.squad_number ?? "–"}</span>
                  <span class="event-player-name">${p.full_name}</span>
                  <span class="event-player-pos">${p.goals} goles</span>
                </button>`)}
              </div>
            </fieldset>`)}
          </div>
          <div class="event-type-row">
            <label>Evento
              <select name="event_type_id">
                ${eventTypes.map((t) => html`<option value="${t.id}">${t.name}</option>`)}
              </select>
            </label>
            <label>Minuto<input type="number" name="time" id="event-minute" min="1" max="120" value="1" /></label>
            <p class="muted small">Pulsa el botón de un jugador arriba para registrar el evento a su nombre.</p>
          </div>
        </form>
        <p class="muted small">Consejo: el campo de minuto se rellena con el cronómetro al pulsar Iniciar.</p>
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Cronología</h2><span class="muted">${events.length} eventos</span></div>
        ${events.length === 0 ? html`<p class="muted">Aún no hay eventos.</p>` : html`
        <ul class="referee-timeline">
          ${events.map((e) => html`<li class="event-${e.system_name}">
            <span class="timeline-minute">${e.time}′</span>
            <span class="timeline-body"><strong>${e.player_name || e.name}</strong><span class="muted small">${e.team_name || ""} · ${e.type_name}</span></span>
            <form method="post" action="/referee/game/${game.id}/events/${e.id}/delete"><button class="btn btn-mini btn-danger">Deshacer</button></form>
          </li>`)}
        </ul>`}
      </section>

      <section class="panel">
        <details>
          <summary class="panel-title">Convocatoria</summary>
          <form method="post" action="/referee/game/${game.id}/squad" class="form">
            <div class="two-col">
              ${[{ ct: game.home_ct, name: game.home_name, players: homePlayers }, { ct: game.away_ct, name: game.away_name, players: awayPlayers }].map((team) => html`
              <div>
                <h3 class="panel-subtitle">${team.name}</h3>
                <div class="squad-list">
                  ${team.players.map((p) => html`<label class="checkbox"><input type="checkbox" name="player" value="${p.competition_player_id}"${p.in_squad ? " checked" : ""}/> <span>${p.squad_number ? `#${p.squad_number} ` : ""}${p.full_name}</span></label>`)}
                </div>
              </div>`)}
            </div>
            <button class="btn btn-primary" type="submit">Guardar convocatoria</button>
          </form>
        </details>
      </section>
    </main>
    <script src="/referee.js" defer></script>
  </body></html>`;
}
