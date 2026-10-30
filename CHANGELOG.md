# Changelog — @ai4u/platform

## 0.7.0 — 2026-10-28

### Añadido
- `@ai4u/platform/instrumentation`: `onRequestError(err, request, context)` para
  `export { onRequestError } from ...` en `instrumentation.ts`. Registra errores de render,
  rutas, acciones y proxy de Next (ERROR + flush) sin headers/cookies/cuerpo/querystring.
  No-op en Edge.
- `@ai4u/platform/client`: `installClientErrorReporter` y `reportClientError` (errores del
  navegador: dedupe 60 s, 5 por sesión, sendBeacon/fetch keepalive, solo pathname).
- `@ai4u/platform/client-errors`: `createClientErrorHandler` (POST sin auth: JSON, tope de
  tamaño, mismo origen, límite por IP en memoria, saneado; responde 204).
- `@ai4u/platform/jobs`: `runJob(name, fn, { log?, rethrow?, tenant? })` para crons.

### Corregido
- `@ai4u/platform/logger`: `serializeErr` enmascara claves y tokens en `message` y `stack`
  (query `?key=`/`token=`/`signature=`…, `Bearer`/`Basic`, JWT, claves `sk-…`/`AIza…`/`ghp_…`/
  `sb_secret_…`, credenciales `user:clave@` en URL). Nueva función pura `redactSecrets(text)`.
  Los correos se enmascaran a `[correo]@dominio` (si el dominio no es ASCII normal, solo
  `[correo]`); es PII, no un secreto (errores de SMTP traen el destinatario) y es fail-closed
  (Unicode, locales largos, localhost/IP, `@` encadenados como `@a@b.com`; falsos positivos aceptados:
  `pkg@1.2.3`, `git@github.com`). Las rutas npm con scope (`/node_modules/@scope/pkg`) no se tocan;
  un correo pegado a una ruta (`https://host/ana@x.com`) sí se enmascara. Lo que precede al
  correo solo se conserva si la racha parece claramente una ruta (`/`, `./`, `../`, `~/`,
  `esquema://` o `node_modules/`); en otro caso (`a/b@x.com`) toda la racha es parte local.
  La query entera de las URLs `http(s)://…?…` se enmascara (`?[redacted]`, el path se conserva) y
  los parámetros `nombre=valor` cuyo nombre TERMINA en token/key/secret/signature/sig/password/
  passwd/pass/auth/credential/session se enmascaran también fuera de URLs. Los tokens se enmascaran completos (sin límite de longitud por token). Se redacta primero
  y luego se recorta: `message` a 16 384 caracteres y `stack` a 32 768 (`…[truncado]`);
  entrada acotada y regex ancladas con lookbehind mantienen el coste lineal.

### Sin cambios
- `withApiHandler`, `getLogger`, `configureTransport` y el resto de la API existente.

## 0.6.2 — 2026-09-30

### Corregido
- `@ai4u/platform/auth`: `parseCookies` (usado por `readIdentity`) llamaba a
  `decodeURIComponent` sin guardia. Una sola cookie con percent-encoding inválido
  (p.ej. `%E0%A4%A`) en el header `Cookie` hacía lanzar `URIError: URI malformed` a
  `readIdentity`, y `withApiHandler` respondía **500** en toda ruta envuelta, con o sin
  `requireModule`/`requireRole` (siempre que hubiera secreto de sesión configurado).
- Ahora una cookie mal codificada se **ignora** y las demás se siguen leyendo (mismo
  criterio que el parser de cookies de Next, `@edge-runtime/cookies`). No se usa el valor
  crudo: así un duplicado basura (`mc_session=<válido>; mc_session=%E0`) no pisa al
  válido. Una `mc_session` mal codificada da identidad `null` (401 donde se exige
  sesión), nunca 500.

### Sin cambios
- API pública y comportamiento con cookies bien codificadas (incluido percent-encoding
  válido y valores con `=`).

## 0.6.1 — 2026-09-30

### Cambiado
- Dependencia `@ai4u/mc-sso` de `github:ai4u-com-co/mc-sso#v1.1.0` a `#v1.2.0`, la
  misma que ya usan las apps. Es aditiva (1.2.0 suma `createMcAuthHandler`,
  `readMcSession`, `mcSessionGuard` y `MC_SESSION_COOKIE`; `verifySession`, lo único
  que usa `@ai4u/platform/auth`, no cambia). Evita que una app termine con dos copias
  de mc-sso (la suya 1.2.0 y la anidada 1.1.0 de platform).
- Reemplaza al PR #10 de bump-bot en el espejo `ai4u-com-co/platform` (la fuente de
  verdad es el monorepo kernel; el espejo se sobrescribe al publicar el tag).

### Sin cambios
- API y comportamiento de todos los subpaths.

## 0.6.0 — 2026-09-30

### Agregado
- Subpath nuevo `@ai4u/platform/gateway-identity` (Fase 3, identidad servicio-a-servicio
  hacia `sap-b1-backend` con OIDC de Vercel):
  - `getGatewayIdentityHeaders(opts?)` → `{ "x-ai4u-identity": <token> }` o `{}`. Pide el
    token a `@vercel/oidc` (`getVercelOidcToken({ audience })`) dentro de cada llamada,
    con tope `timeoutMs` (default 1500 ms). Fail-open: nunca lanza. Nunca loguea el token
    (JWTs redactados en mensajes de error); en Vercel 1 `warn`/min por instancia, fuera
    de Vercel `debug`. Opciones `getToken` y `logger` inyectables.
  - Constantes `GATEWAY_IDENTITY_HEADER` (`x-ai4u-identity`), `GATEWAY_OIDC_AUDIENCE`
    (`https://sap-b1-backend.ai4u`) y `GATEWAY_IDENTITY_TIMEOUT_MS` (1500).
  - Reemplaza al `lib/gateway-identity.ts` copiado en mission-control, ai4u-kpis y
    planeador-produccion (misma semántica).
- Dependencia `@vercel/oidc` ^3.8.9. Solo la carga el subpath `gateway-identity`: el barrel
  raíz (`@ai4u/platform`) no lo re-exporta.

### Sin cambios
- Logger, errores, http, auth y security: sin cambios de API ni de comportamiento.
