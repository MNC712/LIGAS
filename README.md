# LIGAS

Gestor de ligas de fútbol sala. Un solo proceso Node.js sirve tres superficies:

| Superficie | URL |
| --- | --- |
| Sitio público de la liga | http://127.0.0.1:5173/es |
| Consola de administración | http://127.0.0.1:5173/admin |
| App de árbitro | http://127.0.0.1:5173/referee |

Toda la interfaz, la base de datos y el catálogo de eventos están en español.

## Stack

- Node.js ≥ 22.5, **sin dependencias de runtime**: `node:sqlite`, `node:http`,
  `node:crypto` y un renderizado SSR propio con template literals (`src/render.mjs`),
  más CSS/JS plano en `public/`.
- Persistencia en SQLite (`data/flm.db`, configurable con `FLM_DB`).

## Puesta en marcha

```sh
npm start         # sirve http://127.0.0.1:5173
```

En el primer arranque la aplicación se auto-inicializa (`src/bootstrap.mjs`):
crea la organización, una temporada y una competición base, el catálogo de tipos
de evento y una cuenta de administrador. Solo rellena lo que falta, así que es
seguro en cada arranque.

La cuenta de administrador usa `LIGAS_ADMIN_EMAIL` (por defecto
`admin@liga.local`). La contraseña sale de `LIGAS_ADMIN_PASSWORD`; si no se
define, se genera una aleatoria y se muestra **una sola vez** por consola en el
primer arranque. Guárdala.

Comandos útiles:

```sh
npm run dev       # arranque con recarga automática (--watch)
npm run reset     # vacía datos deportivos conservando la estructura de competición
npm test          # tests unitarios del dominio (clasificación, estadísticas, zonas horarias)
npm run smoke     # prueba end-to-end de las rutas de escritura con base de datos y servidor desechables
```

## Arquitectura

```
src/bootstrap.mjs     valores por defecto de una base nueva (organización,
                      temporada, competición, administrador, tipos de evento)
src/db.mjs            esquema + conexión (organization, competition,
                      competition_group, round, game, game_team, game_player,
                      event, event_type, team, player, user, session,
                      change_log, sponsor, …)
src/domain.mjs        clasificación, estadísticas de jugadores, conversión de
                      zonas horarias, hashing de contraseñas, slugificación
src/repo.mjs          consultas compartidas (competiciones, partidos, eventos,
                      equipos, jugadores)
src/public-views.mjs  sitio público (clasificación por grupos, playoff,
                      calendario, resultados, listado de jugadores, equipos,
                      centro de partido, archivo, calendario mensual)
src/admin-views.mjs   consola de administración + app de árbitro
src/server.mjs        enrutado, sesiones (scrypt + cookie HttpOnly) y endpoints de escritura
public/               styles.css, live.js (marcador en vivo), referee.js (reloj)
```

La regla de capas es: las vistas solo **leen** a través de `repo` y `domain`;
las **escrituras** viven en `server.mjs` y siempre recalculan el estado derivado
(marcador a partir de los goles, agregados de jugador al finalizar el partido)
en lugar de confiar en los valores enviados.

## Reglas de dominio destacadas

- Puntuación 3/1/0; un partido finalizado sin resultado cuenta como jugado.
- Desempate: puntos → diferencia de goles → goles a favor → victorias.
- El marcador se deriva de los eventos (`Gol` / `Gol en propia`).
- Modelo único «grupos + playoff»: cada grupo tiene su propia tabla y las
  eliminatorias se arman a mano. Los partidos y las jornadas se crean, ordenan
  y eliminan manualmente desde la consola; no hay generador automático.
- Plantillas de creación rápida: Liga (1 grupo), Torneo (grupos + playoff) y
  Copa (solo eliminatorias) crean la estructura inicial al guardar.
- Patrocinadores: nombre, logo y enlace, activos o no; se muestran en la
  portada y en el pie de página de todo el sitio público.
- La app de árbitro registra eventos y cambios de estado en vivo sin recargar
  la página (sondeo cada pocos segundos).
- Nomenclatura en español: Jornada, Tarjeta amarilla/roja, Asistencia, Gol en propia.

## Limitaciones

- Una sola organización y un solo idioma (español).
- Las confrontaciones del playoff se renderizan a partir de los partidos de la
  fase de eliminatorias; el cuadro no se genera automáticamente.
- La autenticación es local (scrypt + cookie de sesión HttpOnly); no hay
  recuperación de contraseña.
