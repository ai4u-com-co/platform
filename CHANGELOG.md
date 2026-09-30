# Changelog — @ai4u/platform

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
