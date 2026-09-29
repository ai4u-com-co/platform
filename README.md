# @ai4u/platform

Preocupaciones transversales del ecosistema **superAI**: logging, errores tipados y
auth (identidad + permisos). Un único paquete que toda app consume igual, para que
estas funcionalidades NO se copien-peguen en cada módulo.

Distribución: igual que `@ai4u/mc-sso` y `@ai4u/design-system` — repo GitHub con `dist/`
commiteado, consumido por tag: `"@ai4u/platform": "github:donchelo/platform#vX.Y.Z"`.

## Instalación

```bash
npm install github:donchelo/platform
```

Depende de `@ai4u/mc-sso` (para verificar sesiones SSO).

## Uso

```ts
// Logger central (niveles, JSON|text, redacción de secretos, contexto por request)
import { getLogger } from "@ai4u/platform/logger"
const log = getLogger("mi-componente")
log.info({ requestId, tenant }, "algo pasó")

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

## Adopción por app

Ver [ADOPTION.md](./ADOPTION.md) — checklist repetible (perfil A = apps con SSO, perfil B = backend).

## Desarrollo

```bash
npm install
npm test          # vitest (errores, logger, http)
npm run build     # tsc → dist/
```

## Publicar una versión

```bash
npm run build                    # regenerar dist/
git add -A && git commit -m "vX.Y.Z: <cambios>"
git tag vX.Y.Z
git push origin main --tags
```

Luego, en cada consumidor, pinear: `"@ai4u/platform": "github:donchelo/platform#vX.Y.Z"`.
