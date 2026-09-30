# Changelog — @ai4u/platform

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
