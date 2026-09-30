/**
 * @ai4u/platform — preocupaciones transversales del ecosistema superAI.
 *
 * Subpaths recomendados (tree-shaking + claridad):
 *   import { getLogger } from "@ai4u/platform/logger"
 *   import { ValidationError } from "@ai4u/platform/errors"
 *   import { withApiHandler } from "@ai4u/platform/http"
 *   import { readIdentity, requireModule } from "@ai4u/platform/auth"
 *   import { safeEqual } from "@ai4u/platform/security"
 *   import { safeEqualEdge } from "@ai4u/platform/security/edge"   (middleware/Edge)
 *   import { getGatewayIdentityHeaders } from "@ai4u/platform/gateway-identity"   (solo servidor)
 *
 * Este barrel re-exporta todo para quien prefiera un único import, SALVO
 * gateway-identity: vive solo en su subpath para que las apps que no hablan con
 * sap-b1-backend no carguen @vercel/oidc.
 */
export * from "./logger"
export * from "./errors"
export * from "./auth"
export * from "./http"
export * from "./security"
