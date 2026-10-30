# Adopción de `@ai4u/platform` — checklist por app

Receta repetible para integrar las preocupaciones transversales (logging, errores,
auth) en cada app del ecosistema superAI. Hay dos perfiles; aplicá el que corresponda.

## 0. Común a todas

1. Agregar la dependencia en `package.json`:
   ```json
   "@ai4u/platform": "github:ai4u-com-co/platform#vX.Y.Z"
   ```
   (Pinea SIEMPRE un tag exacto publicado, `bump-bot` lo actualiza. Para validar local sin publicar:
   `npm install --no-save ../platform`.)
2. Crear `lib/observability.ts`:
   ```ts
   import { configureTransport, setServiceName } from "@ai4u/platform/logger"
   let started = false
   export function bootstrapObservability(): void {
     if (started) return
     started = true
     setServiceName("<APP_ID>")               // p.ej. "kpis", "sap-b1-backend"
     const endpoint = process.env.PLATFORM_INGEST_URL
     const secret = process.env.INGEST_SECRET
     if (endpoint && secret) configureTransport({ endpoint, secret })
   }
   ```
3. Crear/editar `instrumentation.ts` para arrancarlo:
   ```ts
   export async function register() {
     if (process.env.NEXT_RUNTIME === "nodejs") {
       const { bootstrapObservability } = await import("@/lib/observability")
       bootstrapObservability()
     }
   }
   ```
4. **Logger**: reemplazar `console.*`/logger propio por:
   ```ts
   import { getLogger } from "@ai4u/platform/logger"
   const log = getLogger("<componente>")
   log.info({ requestId, tenant }, "mensaje")
   ```
   Si la app YA tiene un `lib/logger.ts` propio con muchos call-sites, NO reescribas los
   call-sites: convertí `lib/logger.ts` en un adaptador que delega en `@ai4u/platform/logger`
   preservando su API (ver `sap-b1-backend/lib/logger.ts` y `orderloader/lib/logger.ts`).
5. **Errores + rutas**: envolver los route handlers con `withApiHandler` y lanzar errores
   tipados en vez de armar respuestas a mano:
   ```ts
   import { withApiHandler } from "@ai4u/platform/http"
   import { ValidationError, NotFoundError } from "@ai4u/platform/errors"
   export const POST = withApiHandler(async (req, ctx) => {
     if (!ok) throw new ValidationError("…")
     return data            // → 200 JSON { ... } con x-request-id
   }, { label: "POST algo" })
   ```
6. Env nuevas: `PLATFORM_INGEST_URL`, `INGEST_SECRET`, y `LOG_FORMAT=json` en prod.
7. Verificar: `npm run type-check` (o `tsc --noEmit`) verde. Bump de changelog.

## A. Apps con SSO (las que tienen `app/api/mc-auth/route.ts`)

Además de lo común, propagar identidad+permisos a la sesión local (los embebe el handoff
de Mission Control en el mc-token):

1. En `mc-auth/route.ts`, pasar el `extra` a `createSession`:
   ```ts
   const sessionToken = createSession(data.tenantId, secret, TTL, {
     userId: data.userId,
     roles: data.roles,
     allowedModules: data.allowedModules,
     displayName: data.displayName,
   })
   ```
   (Requiere el `@ai4u/mc-sso` nuevo. Local: `npm install --no-save ../mc-sso`.)
2. Donde la app decodifica la sesión (`lib/session.ts` o equivalente), exponer
   `userId/roles/allowedModules` desde el payload.
3. Gatear rutas/acciones sensibles con `requireModule(identity, "<modulo>")` o leyendo
   `ctx.identity` dentro de `withApiHandler`. Ver `kpis/app/api/kpis/route.ts` como patrón.

Apps en esta categoría: planeador-produccion, sap-b1-chat, creador-clientes, desarrollo-oc,
desarrollo-articulos-tama, solicitudes-desarrollo-tama, magdalena-proyeccion, share-of-voice,
social-listening, content-machine. (kpis ya hecho.)

## B. Servicios backend (auth servicio↔servicio, sin sesión de navegador)

Además de lo común:

1. Reemplazar el chequeo de `x-mc-secret`/`X-API-Key` ad-hoc por
   `verifyServiceRequest(req, { sharedSecret, apiKeys })` de `@ai4u/platform/auth`, o usar
   `withApiHandler(..., { requireService: true, serviceAuth: { ... } })`.
2. Logger central + observabilidad como en el común.

Apps en esta categoría: sap-b1-backend (hecho, logger), changelog-service, magdalena-backend,
apify-service, sabio-backend (usa x-internal-secret), cobro-cartera (cron).

> Nota local: validar con `npm install --no-save ../platform [../mc-sso]` puede podar
> dev-deps del node_modules de la app. Antes de correr la app, hacé un `npm install` limpio
> (o instalá el tag publicado de @ai4u/platform). No afecta el código ni el type-check.

## Olas sugeridas

1. **Ola SSO-1** (ya validadas con mc-auth idéntico): planeador-produccion, sap-b1-chat,
   creador-clientes, desarrollo-oc.
2. **Ola SSO-2**: desarrollo-articulos-tama, solicitudes-desarrollo-tama, magdalena-proyeccion,
   content-machine.
3. **Ola análisis** (middleware Web Crypto propio): share-of-voice, social-listening.
4. **Ola backend**: changelog-service, magdalena-backend, apify-service.
