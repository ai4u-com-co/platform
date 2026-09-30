"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
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
__exportStar(require("./logger"), exports);
__exportStar(require("./errors"), exports);
__exportStar(require("./auth"), exports);
__exportStar(require("./http"), exports);
__exportStar(require("./security"), exports);
