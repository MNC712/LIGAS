// Administration console and referee application views.
import { html, raw, icons, crest, escapeHtml } from "./render.mjs";
import { fmtDate, fmtDateTime, fmtTime, statusLabel } from "./domain.mjs";

const NAV = [
  { key: "dashboard", href: "/admin", label: "Panel", icon: "chart" },
  { key: "teams", href: "/admin/teams", label: "Equipos", icon: "shield" },
  { key: "players", href: "/admin/players", label: "Jugadores", icon: "users" },
  { key: "competitions", href: "/admin/competitions", label: "Competiciones", icon: "trophy" },
  { key: "schedule", href: "/admin/schedule", label: "Calendario", icon: "calendar" },
  { key: "games", href: "/admin/games", label: "Partidos y resultados", icon: "ball" },
  { key: "messages", href: "/admin/messages", label: "Mensajes", icon: "edit" },
  { key: "settings", href: "/admin/settings", label: "Ajustes", icon: "shield" },
];

function flash(query) {
  if (query.ok) return html`<div class="alert alert-success">${query.ok}</div>`;
  if (query.err) return html`<div class="alert alert-error">${query.err}</div>`;
  return html``;
}

export function adminPage(scope, { title, subtitle = "", body, active = "dashboard", user, query = {}, actions = "" }) {
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
      <a class="admin-link" href="/referee">${icons.whistle({ size: 18 })}<span>App de árbitro</span></a>
      <a class="admin-link" href="/es" target="_blank">${icons.arrow({ size: 18 })}<span>Ver el sitio de la liga</span></a>
      <div class="admin-user">
        <span class="avatar avatar--empty">${(user?.name || "A")[0]}</span>
        <span>${user?.name || user?.email || ""}<small>${user?.role || ""}</small></span>
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
    <p class="auth-hint">Cuentas de prueba:<br /><code>admin@aquaopen.local / Admin123!</code><br /><code>referee@aquaopen.local / Referee123!</code></p>
    <p class="auth-back"><a href="/es">← Volver al sitio de la liga</a></p>
  </div>
</body></html>`;
}

/* --------------------------------------------------------------- dashboard */

export function dashboardView(scope, data) {
  const { counts, recent, upcoming, unread } = data;
  const body = html`
    <div class="kpi-grid">
      ${[
        ["Equipos", counts.teams, "/admin/teams"],
        ["Jugadores", counts.players, "/admin/players"],
        ["Partidos", counts.games, "/admin/games"],
        ["Goles", counts.goals, "/admin/games"],
        ["Pendientes", counts.upcoming, "/admin/games?status=NOT_STARTED"],
        ["Mensajes sin leer", unread, "/admin/messages"],
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
        <div class="panel-head"><h2 class="panel-title">Próximos partidos</h2><a class="link-more" href="/admin/schedule">Calendario</a></div>
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
      <div class="panel-head"><h2 class="panel-title">Quick actions</h2></div>
      <div class="quick-actions">
        <a class="quick" href="/admin/schedule">${icons.calendar({ size: 22 })}<span>Generar un calendario</span></a>
        <a class="quick" href="/admin/games?status=NOT_STARTED">${icons.ball({ size: 22 })}<span>Introducir un resultado</span></a>
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
  return adminPage(scope, {
    title: "Competiciones", active: "competitions", user, query,
    body: html`<section class="panel">
      <table class="data-table">
        <thead><tr><th>Competición</th><th>Tipo</th><th>Temporada</th><th class="num">Equipos</th><th class="num">Partidos</th><th>Estado</th><th class="num">Acciones</th></tr></thead>
        <tbody>${competitions.map((c) => html`<tr>
          <td><strong>${c.type === "CUP" ? (c.cup_name || c.name) : c.name}</strong><br /><span class="muted small"><code>${c.slug || "—"}</code></span></td>
          <td><span class="pill">${c.type}</span></td>
          <td class="muted">${c.season_name || "—"}</td>
          <td class="num">${c.teams}</td><td class="num">${c.games}</td>
          <td>${c.is_archive ? html`<span class="pill pill-muted">Archivada</span>` : html`<span class="pill pill-live">Publicada</span>`}</td>
          <td class="num"><a class="btn btn-mini" href="/admin/competitions/${c.id}">Editar</a></td>
        </tr>`)}</tbody>
      </table>
    </section>`,
  });
}

export function competitionFormView(scope, { competition, user, query }) {
  const c = competition;
  const body = html`<section class="panel form-panel">
    <form method="post" action="/admin/competitions/${c.id}/save" class="form">
      <div class="field-row">
        <label>Nombre<input name="name" value="${c.name}" /></label>
        <label>Duración de la parte (minutos)<input type="number" name="half_time" min="1" max="60" value="${c.half_time}" /></label>
      </div>
      <fieldset class="fieldset">
        <legend>Puntos de liga</legend>
        <div class="field-row three">
          <label>Victoria<input type="number" name="points_win" value="${c.points_win}" /></label>
          <label>Empate<input type="number" name="points_draw" value="${c.points_draw}" /></label>
          <label>Derrota<input type="number" name="points_lose" value="${c.points_lose}" /></label>
        </div>
      </fieldset>
      <fieldset class="fieldset">
        <legend>Desempates (orden aplicado: puntos, diferencia de goles, goles a favor, victorias)</legend>
        <div class="field-row three">
          <label>Puntos<select name="ranking_points"><option value="DESC"${c.ranking_points === "DESC" ? " selected" : ""}>Mayor primero</option><option value="ASC"${c.ranking_points === "ASC" ? " selected" : ""}>Menor primero</option></select></label>
          <label>Diferencia de goles<select name="ranking_goal_diff"><option value="DESC"${c.ranking_goal_diff === "DESC" ? " selected" : ""}>Mayor primero</option><option value="ASC"${c.ranking_goal_diff === "ASC" ? " selected" : ""}>Menor primero</option></select></label>
          <label>Goles a favor<select name="ranking_goals_scored"><option value="DESC"${c.ranking_goals_scored === "DESC" ? " selected" : ""}>Mayor primero</option><option value="ASC"${c.ranking_goals_scored === "ASC" ? " selected" : ""}>Menor primero</option></select></label>
        </div>
      </fieldset>
      <div class="field-row">
        <label>Suspensión por tarjeta roja (partidos)<input type="number" name="red_card_matches" min="0" value="${c.red_card_suspension_matches}" /></label>
        <label class="checkbox-line"><input type="checkbox" name="is_archive"${c.is_archive ? " checked" : ""}/> Temporada archivada</label>
      </div>
      ${c.type === "CUP" ? html`<p class="muted">Formato de copa: ${c.cup_format || "—"} · fase: ${c.cup_phase || "—"}. Los partidos del cuadro se gestionan desde <a href="/admin/games">Partidos</a>.</p>` : ""}
      <div class="form-actions"><button class="btn btn-primary" type="submit">Guardar ajustes</button></div>
    </form>
  </section>`;
  return adminPage(scope, { title: c.name, subtitle: `${c.type} · ${c.season_name || ""}`, body, active: "competitions", user, query });
}

/* --------------------------------------------------------------- schedule */

export function scheduleAdminView(scope, { competitions, selected, rounds, pitches, user, query }) {
  const roundRows = rounds.map((r) => ({
    ...r,
    games: r.games,
    finished: r.finished,
  }));
  const body = html`
    <div class="two-col">
      <section class="panel form-panel">
        <h2 class="panel-title">Generar jornadas</h2>
        <p class="muted small">Liga a doble vuelta: cada equipo juega contra todos los demás en casa y fuera. Las fechas avanzan una semana por jornada.</p>
        <form method="post" action="/admin/schedule/generate" class="form">
          <label>Competición
            <select name="competition_id">
              ${competitions.map((c) => html`<option value="${c.id}"${String(selected) === String(c.id) ? " selected" : ""}>${c.type === "CUP" ? (c.cup_name || c.name) : c.name}</option>`)}
            </select>
          </label>
          <div class="field-row">
            <label>Fecha del primer partido<input type="date" name="start_date" required value="${new Date().toISOString().slice(0, 10)}" /></label>
            <label>Día del partido
              <select name="weekday">
                ${["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"].map((d, i) => html`<option value="${i}"${i === 6 ? " selected" : ""}>${d}</option>`)}
              </select>
            </label>
          </div>
          <div class="field-row">
            <label>Horarios de inicio<input name="times" value="18:00, 19:00, 20:00" placeholder="18:00, 19:00" /></label>
            <label>Cancha
              <select name="pitch_id">
                <option value="">—</option>
                ${pitches.map((p) => html`<option value="${p.id}">${p.name}</option>`)}
              </select>
            </label>
          </div>
          <label class="checkbox-line"><input type="checkbox" name="double_round" checked /> Ida y vuelta (casa y fuera)</label>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Generar calendario</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Jornadas</h2><a class="link-more" href="/admin/games">Ver partidos</a></div>
        ${roundRows.length === 0 ? html`<p class="muted">Aún no hay jornadas en esta competición.</p>` : html`
        <table class="data-table compact">
          <thead><tr><th>Jornada</th><th class="num">Partidos</th><th class="num">Terminados</th><th class="num">Acciones</th></tr></thead>
          <tbody>${roundRows.map((r) => html`<tr>
            <td>${r.name}</td><td class="num">${r.games}</td><td class="num">${r.finished}</td>
            <td class="num row-actions">
              <a class="btn btn-mini" href="/admin/games?competition=${selected}&round=${r.id}">Partidos</a>
              <form method="post" action="/admin/schedule/rounds/${r.id}/delete" onsubmit="return confirm('¿Eliminar esta jornada y sus partidos?')">
                <button class="btn btn-mini btn-danger" type="submit">Eliminar</button>
              </form>
            </td>
          </tr>`)}</tbody>
        </table>`}
      </section>
    </div>`;
  return adminPage(scope, { title: "Calendario", subtitle: "Genera jornadas y gestiona los partidos", body, active: "schedule", user, query });
}

/* ------------------------------------------------------------------- games */

export function adminGamesView(scope, { games, competitions, competitionId, status, roundId, user, query }) {
  const tz = scope.theme.timezone;
  return adminPage(scope, {
    title: "Partidos y resultados", subtitle: "Introduce marcadores, eventos y datos del partido", active: "games", user, query,
    body: html`<section class="panel">
      <div class="panel-head">
        <form class="list-filter" method="get" action="/admin/games">
          <select name="competition" onchange="this.form.submit()">
            <option value="">Todas las competiciones</option>
            ${competitions.map((c) => html`<option value="${c.id}"${String(competitionId) === String(c.id) ? " selected" : ""}>${c.type === "CUP" ? (c.cup_name || c.name) : c.name}</option>`)}
          </select>
          <select name="status" onchange="this.form.submit()">
            ${["", "NOT_STARTED", "STARTED", "FINISHED"].map((s) => html`<option value="${s}"${status === s ? " selected" : ""}>${s ? statusLabel(s) : "Todos los estados"}</option>`)}
          </select>
        </form>
        <a class="btn btn-ghost" href="/referee">Abrir la app de árbitro</a>
      </div>
      <table class="data-table">
        <thead><tr><th>Fecha</th><th>Competición</th><th>Partido</th><th class="center">Marcador</th><th>Estado</th><th class="num">Acciones</th></tr></thead>
        <tbody>${games.map((g) => html`<tr>
          <td class="muted nowrap">${fmtDateTime(g.game_date, tz)}</td>
          <td class="muted small">${g.competition_name}</td>
          <td>${g.home_name} <span class="muted">vs</span> ${g.away_name}</td>
          <td class="center score-cell">${g.score_home !== null && g.score_home !== undefined && g.score_away !== null && g.score_away !== undefined ? `${g.score_home} - ${g.score_away}` : "—"}</td>
          <td><span class="pill ${g.status === "FINISHED" ? "pill-muted" : g.status === "STARTED" ? "pill-live" : ""}">${statusLabel(g.status)}</span></td>
          <td class="num"><a class="btn btn-mini" href="/admin/games/${g.id}">Editar</a></td>
        </tr>`)}</tbody>
      </table>
    </section>`,
  });
}

export function adminGameEditView(scope, data) {
  const { game, events, eventTypes, homePlayers, awayPlayers, user, query } = data;
  const tz = scope.theme.timezone;
  const playersFor = (ct) => (ct === game.home_ct ? homePlayers : awayPlayers);
  return adminPage(scope, {
    title: "Editar resultado", subtitle: `${game.home_name} vs ${game.away_name} · ${game.round_name || ""}`, active: "games", user, query,
    body: html`
      <div class="two-col">
        <section class="panel form-panel">
          <h2 class="panel-title">Resultado</h2>
          <p class="muted">${fmtDateTime(game.game_date, tz)} · ${game.pitch_name || "Sin sede"}</p>
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
            <div class="field-row">
              <label>Fecha y hora<input type="datetime-local" name="game_date" value="${game.game_date ? game.game_date.slice(0, 16) : ""}" /></label>
              <label>Código<input name="code" value="${game.code || ""}" /></label>
            </div>
            <div class="form-actions"><button class="btn btn-primary" type="submit">Guardar resultado</button></div>
          </form>
        </section>

        <section class="panel form-panel">
          <h2 class="panel-title">Añadir evento</h2>
          <form method="post" action="/admin/games/${game.id}/events" class="form">
            <div class="field-row">
              <label>Equipo
                <select name="competition_team_id" id="event-team" onchange="document.querySelectorAll('#event-player option').forEach(o=>{o.hidden=o.dataset.team!==this.value});this.form.player.selectedIndex=0;">
                  <option value="${game.home_ct}">${game.home_name}</option>
                  <option value="${game.away_ct}">${game.away_name}</option>
                </select>
              </label>
              <label>Tipo
                <select name="event_type_id">
                  ${eventTypes.map((t) => html`<option value="${t.id}">${t.name}</option>`)}
                </select>
              </label>
            </div>
            <label>Jugador
              <select name="competition_player_id">
                <option value="">—</option>
                ${[...homePlayers.map((p) => ({ ...p, team: game.home_ct })), ...awayPlayers.map((p) => ({ ...p, team: game.away_ct }))]
                  .map((p) => html`<option value="${p.competition_player_id}" data-team="${p.team}">${p.full_name} (${p.team_name})</option>`)}
              </select>
            </label>
            <label>Minuto<input type="number" name="time" min="1" max="120" value="1" /></label>
            <div class="form-actions"><button class="btn btn-primary" type="submit">Añadir evento</button></div>
          </form>
          <p class="muted small">Los eventos alimentan la página pública del partido y los totales de los jugadores. Los goles también actualizan la clasificación.</p>
        </section>
      </div>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Eventos</h2></div>
        ${events.length === 0 ? html`<p class="muted">Sin eventos registrados.</p>` : html`
        <table class="data-table compact"><tbody>
          ${events.map((e) => html`<tr>
            <td class="num">${e.time}′</td>
            <td>${e.type_name}</td>
            <td>${e.player_name || "—"}</td>
            <td class="muted">${e.team_name || ""}</td>
            <td class="num row-actions"><form method="post" action="/admin/games/${game.id}/events/${e.id}/delete"><button class="btn btn-mini btn-danger">Eliminar</button></form></td>
          </tr>`)}
        </tbody></table>`}
      </section>`,
  });
}

/* ------------------------------------------------------------------ others */

export function messagesView(scope, { messages, user, query }) {
  return adminPage(scope, {
    title: "Mensajes", subtitle: "Envíos del formulario de contacto", active: "messages", user, query,
    body: html`<section class="panel">
      ${messages.length === 0 ? html`<p class="muted">Aún no hay mensajes.</p>` : html`
      <table class="data-table">
        <thead><tr><th>Recibido</th><th>De</th><th>Asunto</th><th>Mensaje</th><th class="num">Acciones</th></tr></thead>
        <tbody>${messages.map((m) => html`<tr class="${m.read ? "" : "is-unread"}">
          <td class="muted nowrap">${fmtDate(m.created_at, scope.theme.timezone)}</td>
          <td>${m.name}<br /><span class="muted small">${m.email}</span></td>
          <td>${m.subject || "—"}</td>
          <td class="message-cell">${m.message}</td>
          <td class="num">${m.read ? "" : html`<form method="post" action="/admin/messages/${m.id}/read"><button class="btn btn-mini">Marcar leído</button></form>`}</td>
        </tr>`)}</tbody>
      </table>`}
    </section>`,
  });
}

export function settingsView(scope, { org, sponsors, contactFields, user, query }) {
  const socials = (() => { try { return JSON.parse(org.socials_json || "{}"); } catch { return {}; } })();
  return adminPage(scope, {
    title: "Ajustes", subtitle: "Identidad de la liga, colores y contactos públicos", active: "settings", user, query,
    body: html`
      <section class="panel form-panel">
        <form method="post" action="/admin/settings/save" class="form">
          <div class="field-row">
            <label>Nombre de la liga<input name="name" value="${org.name}" /></label>
            <label>Correo de contacto<input type="email" name="contact_email" value="${org.contact_email || ""}" /></label>
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
      </section>

      <div class="two-col">
        <section class="panel">
          <h2 class="panel-title">Campos de contacto</h2>
          <table class="data-table compact"><tbody>
            ${contactFields.map((f) => html`<tr><td>${f.name}</td><td><a href="mailto:${f.value}">${f.value}</a></td></tr>`)}
          </tbody></table>
        </section>
        <section class="panel">
          <h2 class="panel-title">Patrocinadores</h2>
          <div class="sponsor-admin">${sponsors.map((s) => html`<div class="sponsor-admin-item"><img src="${s.image_url}" alt="${s.name}" /><span>${s.name}</span></div>`)}</div>
        </section>
      </div>`,
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
