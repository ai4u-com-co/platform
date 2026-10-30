# @ai4u/platform

Preocupaciones transversales del ecosistema **superAI**: logging, errores tipados y
auth (identidad + permisos). Un único paquete que toda app consume igual, para que
estas funcionalidades NO se copien-peguen en cada módulo.

Distribución: igual que `@ai4u/mc-sso` y `@ai4u/design-system`. El código fuente vive en el
monorepo [`ai4u-com-co/kernel`](https://github.com/ai4u-com-co/kernel) (`packages/platform/`,
con `dist/` commiteado). Cada tag `platform-vX.Y.Z` de kernel se publica, vía
`.github/workflows/mirror.yml`, como commit + tag `vX.Y.Z` en el espejo de solo lectura
`ai4u-com-co/platform`, que es de donde instalan los consumidores:
`"@ai4u/platform": "github:ai4u-com-co/platform#vX.Y.Z"`.

## Instalación

```bash
npm install github:ai4u-com-co/platform#vX.Y.Z   # siempre pineado por tag, nunca una rama
```

Depende de `@ai4u/mc-sso` (para verificar sesiones SSO).

## Uso

```ts
// Logger central (niveles, JSON|text, redacción de secretos, contexto por request)
import { getLogger } from "@ai4u/platform/logger"
const log = getLogger("mi-componente")
log.info({ requestId, tenant }, "algo pasó")
// `log.error({ err }, ...)`: serializeErr enmascara claves y tokens en message y stack
// (?key=, ?token=, Bearer/Basic, JWT, sk-…/AIza…/ghp_…, user:clave@host). Mantiene el resto
// de la URL. Los correos se enmascaran a `[correo]@dominio` (PII, no un secreto; fail-closed, incluye `@a@b.com` y correos pegados a rutas; las rutas npm `@scope/pkg` se respetan; la ruta previa al correo solo se conserva si la racha empieza por `/`, `./`, `../`, `~/`, `esquema://` o contiene `node_modules/`). La query de las URLs se enmascara entera (`?[redacted]`) y los parámetros con nombre terminado en token/key/secret/sig/password/pass/auth/credential/session también. los tokens se enmascaran completos (sin límite por token); tras redactar, message se recorta a 16 384 caracteres y stack a 32 768 (…[truncado]). También exportada como `redactSecrets(text)` por si necesitas sanear a mano.

// Errores tipados y categorizados (validación / negocio / infraestructura)
import { ValidationError, NotFoundError } from "@ai4u/platform/errors"
throw new ValidationError("falta el nombre")

// Wrapper de rutas: x-request-id + logging + captura/clasificación + JSON uniforme
import { withApiHandler } from "@ai4u/platform/http"
export const POST = withApiHandler(async (req, ctx) => {
  // ctx.requestId, ctx.log, ctx.identity
  return { ok: true }                       // → 200 { ok:true } con x-request-id
}, { label: "POST cosa", requireModule: "kpis" })

// Auth: identidad + permisos uniformes
import { readIdentity, requireModule, verifyServiceRequest } from "@ai4u/platform/auth"

// Comparación de secretos en tiempo constante
import { safeEqual } from "@ai4u/platform/security"
```

## Comparar secretos (v0.5.0)

Nunca compares un secreto con `===` (sale en el primer carácter distinto y filtra por tiempo).

```ts
// Node (route handlers, backends, crons)
import { safeEqual } from "@ai4u/platform/security"
if (!safeEqual(req.headers.get("authorization"), `Bearer ${process.env.CRON_SECRET}`)) return new Response(null, { status: 401 })

// middleware / proxy / Edge Runtime (Web Crypto, sin node:*)
import { safeEqualEdge } from "@ai4u/platform/security/edge"
if (!(await safeEqualEdge(req.headers.get("x-mc-secret"), process.env.MISSION_CONTROL_SECRET))) { /* 401 */ }
```

- `safeEqual(a, b): boolean` — SHA-256 de ambos + `crypto.timingSafeEqual`; tolera largos distintos sin filtrarlos.
- `safeEqualEdge(a, b): Promise<boolean>` — mismo contrato con `crypto.subtle`, sin salida temprana.
- En ambos, `undefined`, `null` y `""` devuelven `false`: un secreto vacío o no configurado nunca autentica.
- `verifyServiceRequest` (`@ai4u/platform/auth`) ya usa `safeEqual` internamente.

## Identidad hacia el gateway SAP (v0.6.0)

Toda llamada a `sap-b1-backend` debe adjuntar el token OIDC de Vercel del deployment
(audiencia `https://sap-b1-backend.ai4u`) en el header `x-ai4u-identity`. Dos líneas:

```ts
import { getGatewayIdentityHeaders } from "@ai4u/platform/gateway-identity"
const res = await fetch(url, { headers: { "x-mc-secret": secret, ...(await getGatewayIdentityHeaders()) } })
```

- `getGatewayIdentityHeaders(opts?): Promise<Record<string, string>>` devuelve
  `{ "x-ai4u-identity": <token> }` o `{}`. **Nunca lanza** (fail-open): sin token (local,
  error del intercambio, timeout de `opts.timeoutMs`, default 1500 ms) la llamada sale igual
  que antes. La auth real (`x-mc-secret` / `X-API-Key`) no cambia.
- El token se pide **en cada llamada** (llamala dentro del request, nunca a nivel de módulo);
  el único caché es el interno de `@vercel/oidc`. El token nunca se loguea: en Vercel emite
  como mucho 1 `warn`/min por instancia si falta; fuera de Vercel solo `debug`.
- Opciones: `timeoutMs`, `getToken` (reemplaza a `getVercelOidcToken`, útil en tests) y
  `logger` (`{ warn, debug }`, default `getLogger("gateway-identity")`).
- Constantes: `GATEWAY_IDENTITY_HEADER`, `GATEWAY_OIDC_AUDIENCE`, `GATEWAY_IDENTITY_TIMEOUT_MS`.
- Solo servidor (Node). Vive **solo** en este subpath: importar `@ai4u/platform` (raíz) no
  carga `@vercel/oidc`.

## Observabilidad (envío a Supabase vía el panel admin)

Cada app arranca el transporte una vez en `instrumentation.ts`:

```ts
import { configureTransport, setServiceName } from "@ai4u/platform/logger"
setServiceName("mi-app")
if (process.env.PLATFORM_INGEST_URL && process.env.INGEST_SECRET) {
  configureTransport({
    endpoint: process.env.PLATFORM_INGEST_URL,   // .../api/ingest/logs del panel admin
    secret: process.env.INGEST_SECRET,
  })
}
```

El transporte es **fire-and-forget en lote**: nunca bloquea ni rompe la app; si el ingest
cae, los logs siguen en stdout. En jobs serverless (cron) llamá `await flushLogs()` al final.

## Errores que no pasan por `withApiHandler` (v0.7.0)

### 1. Errores de render/rutas/acciones del servidor — `@ai4u/platform/instrumentation`

```ts
// instrumentation.ts (junto a register())
export { onRequestError } from "@ai4u/platform/instrumentation"
```

Next llama al hook cuando falla un render RSC, un route handler, una server action o el proxy.
Registra a nivel ERROR (mensaje + stack, `digest`, `path` sin querystring, método, `routerKind`,
`routeType`, `routePath`) y hace `await flushLogs()`. **Nunca** registra headers, cookies ni cuerpo.
Solo corre en runtime Node; en Edge es un no-op. Requiere que `register()` haya configurado el
transporte (ver sección anterior).

### 2. Errores del navegador — `@ai4u/platform/client` + `/client-errors`

```tsx
// components/ClientErrors.tsx  ("use client"), montado una vez en app/layout.tsx
useEffect(() => { installClientErrorReporter({ service: "mi-app" }) }, [])

// app/error.tsx y app/global-error.tsx ("use client")
useEffect(() => { reportClientError(error, { digest: error.digest ?? "" }) }, [error])
```

```ts
// app/api/client-error/route.ts
import { createClientErrorHandler } from "@ai4u/platform/client-errors"
export const POST = createClientErrorHandler()   // { maxBytes = 8192, maxPerMinute = 20 }
```

- Cliente: escucha `error` y `unhandledrejection` (con `addEventListener`, sin pisar un
  `window.onerror` existente); idempotente; deduplica la misma firma durante 60 s; máximo 5
  reportes por carga de página; `sendBeacon` con fallback a `fetch keepalive`; trunca mensaje (2 000)
  y stack (4 000); solo envía `location.pathname`. Ignora errores de carga de recursos,
  `Script error.` y `ResizeObserver loop`.
- Servidor: acepta solo `application/json` (415), tope de tamaño (413), mismo origen por
  `Sec-Fetch-Site`/`Origin` (403), límite por IP (429), forma validada (400); responde 204 sin eco.
  Registra `level=ERROR`, `component="client"`, `category="client"`.
- **Riesgo (endpoint sin autenticación):** cualquiera puede intentar enviar basura a
  `platform_logs`. Mitigaciones: las anteriores + saneado/truncado de campos. El límite por IP vive
  en memoria de cada instancia (mejor esfuerzo en serverless; se reinicia en cold start) y las
  cabeceras de origen las puede falsificar un cliente que no sea navegador: para protección real
  añade el rate-limit/WAF de la plataforma. Los campos del cliente son **datos no confiables**:
  se registran como datos y nunca fijan nivel, servicio ni component.
- Si la app tiene proxy/middleware con auth, deja pública `/api/client-error`.

### 3. Crons y trabajos en segundo plano — `@ai4u/platform/jobs`

```ts
import { runJob } from "@ai4u/platform/jobs"
export const GET = async () =>
  Response.json(await runJob("sync-clientes", async (log) => syncClientes(log)))
// runJob(name, fn, { log?, rethrow = true, tenant? })
```

Registra inicio/fin con duración; si `fn` lanza, `log.error({ err, job })` y relanza (o devuelve
`undefined` con `rethrow: false`); si el resultado trae `errors`/`errores` > 0 (número o array)
registra `log.error` con el resumen sin cambiar lo devuelto; siempre `await flushLogs()` al final.

## Adopción por app

Ver [ADOPTION.md](./ADOPTION.md) — checklist repetible (perfil A = apps con SSO, perfil B = backend).

## Desarrollo

```bash
npm install
npm test          # vitest (errores, logger, http)
npm run build     # tsc → dist/
```

## Publicar una versión

Se publica desde `ai4u-com-co/kernel`, nunca commiteando directo en el espejo
`ai4u-com-co/platform` (el próximo sync lo pisaría):

1. En una rama de kernel: subir `version` en `packages/platform/package.json`, anotar el
   cambio en `packages/platform/CHANGELOG.md` y regenerar `dist/`
   (`npm run build --workspace=packages/platform`, o `npm run build` desde la raíz).
   El CI de kernel falla si `dist/` no coincide con el build fresco.
2. PR a `main` de kernel, con CI en verde, y merge.
3. Tag sobre el commit mergeado, con prefijo de paquete:

   ```bash
   git tag platform-vX.Y.Z
   git push origin platform-vX.Y.Z
   ```

4. `mirror.yml` compila el paquete y publica commit + tag `vX.Y.Z` en `ai4u-com-co/platform`.
5. En cada consumidor, pinear `"@ai4u/platform": "github:ai4u-com-co/platform#vX.Y.Z"`
   (el bump-bot de la org es el que abre esos PRs en los consumidores).
