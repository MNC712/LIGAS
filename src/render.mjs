// Minimal server-side HTML rendering. Values are escaped unless wrapped in raw().
export class Raw {
  constructor(value) { this.value = String(value); }
  toString() { return this.value; }
}
export const raw = (v) => new Raw(v);

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function renderValue(v) {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(renderValue).join("");
  return escapeHtml(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new Raw(out);
}

export const attr = (v) => escapeHtml(v ?? "");
export const isActive = (a, b) => (a === b ? " active" : "");

/* ------------------------------------------------------------------ icons */

const svg = (path, { size = 18, cls = "", fill = "none", stroke = "currentColor" } = {}) =>
  raw(`<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`);

export const icons = {
  trophy: (p) => svg(`<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1"/>`, p),
  bars: (p) => svg(`<path d="M4 20V14M10 20V10M16 20V4M22 20H2"/>`, p),
  ball: (p) => svg(`<circle cx="12" cy="12" r="9"/><path d="m12 7 3 2-1 4h-4L9 9l3-2Z"/><path d="M12 3v4M4.5 10.5 9 9M19.5 10.5 15 9M7 19l2-6M17 19l-2-6"/>`, p),
  pin: (p) => svg(`<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>`, p),
  menu: (p) => svg(`<path d="M4 7h16M4 12h16M4 17h16"/>`, p),
  close: (p) => svg(`<path d="M6 6l12 12M18 6 6 18"/>`, p),
  arrow: (p) => svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`, p),
  calendar: (p) => svg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>`, p),
  shield: (p) => svg(`<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3Z"/>`, p),
  edit: (p) => svg(`<path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="m14 6 4 4"/>`, p),
  plus: (p) => svg(`<path d="M12 5v14M5 12h14"/>`, p),
  check: (p) => svg(`<path d="m5 13 4 4L19 7"/>`, p),
  clock: (p) => svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`, p),
  card: (p) => svg(`<rect x="6" y="3" width="12" height="18" rx="2"/>`, p),
  users: (p) => svg(`<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5a3 3 0 0 1 0 6M17 20a5.5 5.5 0 0 0-2-4"/>`, p),
  chart: (p) => svg(`<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8"/>`, p),
  whistle: (p) => svg(`<path d="M14 8h7v5a6 6 0 0 1-6 6H9a6 6 0 0 1 0-12h5"/><circle cx="6" cy="13" r="3"/>`, p),
};

/* --------------------------------------------------------------- fragments */

export function crest(url, name, cls = "crest") {
  if (!url) return html`<span class="${cls} ${cls}--empty" title="${name}">${(name || "?").slice(0, 2).toUpperCase()}</span>`;
  return html`<img class="${cls}" src="${url}" alt="${name}" loading="lazy" />`;
}

const FORM_CLASS = { W: "form-w", D: "form-d", L: "form-l" };
export function formBadges(form = []) {
  return html`<span class="form-badges">${form.map((f) => html`<span class="form-badge ${FORM_CLASS[f] || ""}">${f}</span>`)}</span>`;
}

export function pagination({ page, lastPage, href, label = "MOSTRAR MÁS" }) {
  if (lastPage <= 1) return html``;
  return html`
    <div class="pagination">
      ${page > 1 ? html`<a class="btn btn-ghost" href="${href(page - 1)}">Anterior</a>` : html`<span class="btn btn-ghost is-disabled">Anterior</span>`}
      <span class="pagination-info">Página ${page} de ${lastPage}</span>
      ${page < lastPage ? html`<a class="btn btn-primary" href="${href(page + 1)}">${label}</a>` : html`<span class="btn btn-ghost is-disabled">${label}</span>`}
    </div>`;
}

export function pageNumbers({ page, lastPage, href }) {
  if (lastPage <= 1) return html``;
  const pages = [];
  for (let i = 1; i <= lastPage; i++) {
    if (i === 1 || i === lastPage || Math.abs(i - page) <= 2) pages.push(i);
    else if (pages[pages.length - 1] !== "…") pages.push("…");
  }
  return html`<nav class="pager" aria-label="Paginación">
    ${pages.map((p) => p === "…"
      ? html`<span class="pager-gap">…</span>`
      : html`<a class="pager-link${p === page ? " is-current" : ""}" href="${href(p)}">${p}</a>`)}
  </nav>`;
}

export function stat(value, label) {
  return html`<div class="stat"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
}

/* ----------------------------------------------------------------- layout */

export function layout({
  org, theme, lang = "es", title, description, body, active = "",
  banner = null, tabs = null, scripts = [], bodyClass = "",
}) {
  const socials = (() => { try { return JSON.parse(org.socials_json || "{}"); } catch { return {}; } })();
  const nav = [
    { href: `/es/tournaments`, label: "Torneos", key: "tournaments" },
    { href: `/es/league`, label: "Liga", key: "league" },
    { href: `/es/calendar`, label: "Calendario", key: "calendar" },
    { href: `/es/contact`, label: "Contacto", key: "contact" },
    { href: `/es/gallery`, label: "Galería", key: "gallery" },
    { href: `/es/league-menu/seasons-archive`, label: "Archivo", key: "archive" },
  ];
  const css = `
    :root{
      --primary:${theme.primary}; --secondary:${theme.secondary};
      --background:${theme.background}; --accent:${theme.accent};
      --text:${theme.text}; --text-secondary:${theme.textSecondary};
    }`;
  return html`<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title ? `${title} - ${org.name}` : org.name}</title>
  <meta name="description" content="${description || ""}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <style>${raw(css)}</style>
</head>
<body class="${bodyClass}">
<a class="skip-link" href="#main">Saltar al contenido</a>
<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="/es" aria-label="${org.name}">
      ${org.logo_url ? html`<img src="${org.logo_url}" alt="${org.name}" />` : html`<span class="brand-fallback">${org.name}</span>`}
    </a>
    <nav class="main-nav" aria-label="Principal">
      ${nav.map((n) => html`<a class="nav-link${active === n.key ? " is-active" : ""}" href="${n.href}">${n.label}</a>`)}
    </nav>
    <div class="header-actions">
      <label class="lang-select">
        <span class="visually-hidden">Idioma</span>
        <select onchange="location.href=this.value">
          <option value="/es" selected>ESP</option>
        </select>
      </label>
      <input type="checkbox" id="nav-toggle" class="nav-toggle" />
      <label for="nav-toggle" class="menu-button" aria-label="Abrir menú">${icons.menu({ size: 26 })}</label>
      <div class="mobile-menu">
        <label for="nav-toggle" class="mobile-close" aria-label="Cerrar menú">${icons.close({ size: 26 })}</label>
        ${nav.map((n) => html`<a href="${n.href}">${n.label}</a>`)}
        <a href="/es">Inicio</a>
      </div>
    </div>
  </div>
</header>
${banner}
${tabs}
<main id="main" class="site-main">${body}</main>
<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-brand">
      ${org.logo_url ? html`<img src="${org.logo_url}" alt="${org.name}" />` : html``}
      <p>${org.name}</p>
    </div>
    <div class="footer-links">
      ${nav.map((n) => html`<a href="${n.href}">${n.label}</a>`)}
    </div>
    <div class="footer-social">
      ${socials.facebook ? html`<a href="${socials.facebook}" target="_blank" rel="noopener">Facebook</a>` : html``}
      ${socials.instagram ? html`<a href="${socials.instagram}" target="_blank" rel="noopener">Instagram</a>` : html``}
      ${socials.youtube ? html`<a href="${socials.youtube}" target="_blank" rel="noopener">YouTube</a>` : html``}
    </div>
  </div>
  <div class="footer-note">
    <p>Recreación local con fines de estudio, construida únicamente a partir del sitio público de la liga y su API GraphQL pública.
      Datos de origen: <a href="https://${org.domain}" target="_blank" rel="noopener">${org.domain}</a>.</p>
  </div>
</footer>
${scripts.map((s) => html`<script src="${s}" defer></script>`)}
</body>
</html>`;
}

/* ----------------------------------------------------------- page banners */

export function pageBanner({ org, title, chip, subtitle, aside }) {
  return html`
  <section class="page-banner">
    <div class="banner-inner">
      <div class="banner-copy">
        ${chip ? html`<span class="banner-chip">${chip}</span>` : html``}
        <h1>${title}</h1>
        ${subtitle ? html`<p class="banner-sub">${subtitle}</p>` : html``}
      </div>
      ${aside ? html`<div class="banner-aside">${aside}</div>` : html``}
    </div>
  </section>`;
}

export function tabsNav(items) {
  return html`<div class="tabs-wrap"><nav class="tabs" aria-label="Section">${items.map((t) =>
    html`<a class="tab${t.active ? " is-active" : ""}" href="${t.href}">${t.label}</a>`)}</nav></div>`;
}

export function emptyState(text, hint) {
  return html`<div class="empty-state"><p class="empty-title">${text}</p>${hint ? html`<p class="empty-hint">${hint}</p>` : html``}</div>`;
}
