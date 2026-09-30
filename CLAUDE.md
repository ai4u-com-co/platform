# CLAUDE.md — @ai4u/platform

Paquete compartido del ecosistema superAI con las preocupaciones transversales: logger central,
errores tipados, wrapper de rutas (`withApiHandler`), auth (identidad + permisos), comparación de
secretos en tiempo constante e identidad OIDC hacia el gateway SAP. Lo consumen las apps y backends
del ecosistema; no es una app, no se despliega: se **publica como tag**.

## Dónde vive el código (importante)
- La fuente de verdad es el monorepo `ai4u-com-co/kernel` (`packages/platform`). Este repo
  (`ai4u-com-co/platform`) es un **espejo** que `kernel/.github/workflows/mirror.yml` sobrescribe
  (`rsync --delete`) al publicar un tag `platform-vX.Y.Z`. Un cambio hecho solo aquí se pierde.
- Rama default de este repo: `main`.

## Stack
- TypeScript (`tsc`), tests con `vitest`. CI usa Node 22. Dependencias: `@ai4u/mc-sso` (pin por tag
  de GitHub) y `@vercel/oidc`. Versión actual en `package.json`: 0.6.2.

## Comandos (de `package.json`)
- `npm ci` — instalar
- `npm run type-check` — `tsc --noEmit`
- `npm test` — `vitest run`
- `npm run build` — `tsc` → `dist/`

## Estructura
- `src/logger` — `getLogger`, `configureTransport`, `setServiceName`, `flushLogs`, contexto por request.
- `src/errors` — errores tipados (`ValidationError`, `NotFoundError`, ...).
- `src/http` — `withApiHandler` (x-request-id, logging, clasificación de errores, JSON uniforme).
- `src/auth` — `readIdentity`, `requireModule`, `verifyServiceRequest`.
- `src/security` (+ `edge.ts`) — `safeEqual` / `safeEqualEdge`.
- `src/gateway-identity` — `getGatewayIdentityHeaders` (header `x-ai4u-identity`, fail-open).
- `tests/` — un archivo por módulo. Docs: `README.md`, `ADOPTION.md`, `CHANGELOG.md`, `GO-LIVE.md`.

## Convenciones y trampas
- **`dist/` se commitea** y los consumidores leen `dist/`, no `src/`. El CI falla si `dist/` no
  coincide con un build fresco: corre `npm run build` y commitea el resultado.
- Cada módulo se importa por subpath (`@ai4u/platform/logger`, `/http`, `/auth`, ...). El raíz no
  carga `@vercel/oidc`; ese vive solo en `/gateway-identity` (solo servidor, Node).
- Secretos: nunca comparar con `===`; usar `safeEqual` (Node) o `safeEqualEdge` (middleware/Edge).
  Vacío, `null` o `undefined` devuelven `false`.
- `getGatewayIdentityHeaders` nunca lanza (fail-open) y debe llamarse dentro del request, no a
  nivel de módulo. No loguear el token.
- Multitenant: `Identity.tenantId` y `verifyServiceRequest` (API keys por tenant) son la base de
  permisos. No hardcodear tenants; todo permiso/consulta con scope por tenant.
- Cualquier llamada a SAP se hace solo vía `sap-b1-backend` (:4100); este paquete solo aporta la
  identidad hacia ese gateway.
- Cambios de comportamiento: agregar entrada en `CHANGELOG.md` y test en `tests/`.

## Variables de entorno (solo nombres; las lee el código)
`MISSION_CONTROL_SECRET` (firma de sesión SSO), `PLATFORM_INGEST_URL` + `INGEST_SECRET` (envío de
logs al panel admin), `LOG_LEVEL`, `LOG_FORMAT`, `SERVICE_ID` / `PLATFORM_SERVICE` (nombre del
servicio), `VERCEL`. Los valores los define cada app consumidora; no van en este repo.

## Publicar una versión
1. Subir `version` en `package.json`, `npm run build`, actualizar `CHANGELOG.md`.
2. PR a `main` de `kernel` (CI: type-check, test, build, `dist/` al día).
3. Tag `platform-vX.Y.Z` en `kernel`: el workflow publica el contenido y el tag `vX.Y.Z` en el espejo.
4. Los consumidores pinean `github:ai4u-com-co/platform#vX.Y.Z` (el bump lo automatiza `bump-bot`).

## Por confirmar
- El `README.md` aún cita `github:donchelo/platform` como origen de instalación, mientras que
  `package.json` de contracts/kernel usan `ai4u-com-co`. Confirmar cuál es el canónico.
- El flujo "PR en kernel + tag" refleja `mirror.yml`; el README de este repo aún describe publicar
  directo con `git tag` sobre este repo.
