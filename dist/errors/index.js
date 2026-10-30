"use strict";
/**
 * Errores tipados y categorizados para todo el ecosistema superAI.
 *
 * Tres categorías (las que pidió el usuario):
 *   - "validation"     → entrada inválida del cliente (400)
 *   - "business"       → regla de negocio violada / conflicto de estado (409/422)
 *   - "infrastructure" → fallo de un sistema externo o del propio servicio (5xx)
 *
 * Generaliza el `classifySapError` de sap-b1-backend para que cualquier app
 * responda errores de forma uniforme y NUNCA falle en silencio.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERIC_ERROR_MESSAGE = exports.ExternalServiceError = exports.ConflictError = exports.ForbiddenError = exports.UnauthorizedError = exports.NotFoundError = exports.InfrastructureError = exports.BusinessError = exports.ValidationError = exports.AppError = void 0;
exports.isAppError = isAppError;
exports.classifyUnknownError = classifyUnknownError;
exports.toErrorResponse = toErrorResponse;
/** Base de toda la jerarquía. Llevar siempre `category`, `httpStatus` y `code`. */
class AppError extends Error {
    constructor(message, category, opts = {}) {
        super(message);
        this.name = new.target.name;
        this.category = category;
        this.httpStatus = opts.httpStatus ?? defaultStatusFor(category);
        this.code = opts.code ?? defaultCodeFor(category);
        this.details = opts.details;
        this.cause = opts.cause;
        this.isOperational = opts.isOperational ?? true;
        // Mantener el stack apuntando al call-site real.
        Error.captureStackTrace?.(this, new.target);
    }
}
exports.AppError = AppError;
function defaultStatusFor(category) {
    switch (category) {
        case "validation": return 400;
        case "business": return 409;
        case "infrastructure": return 502;
    }
}
function defaultCodeFor(category) {
    switch (category) {
        case "validation": return "VALIDATION_FAILED";
        case "business": return "BUSINESS_RULE_VIOLATION";
        case "infrastructure": return "INFRASTRUCTURE_ERROR";
    }
}
/* ── Subclases por categoría ─────────────────────────────────────────────── */
class ValidationError extends AppError {
    constructor(message, opts = {}) {
        super(message, "validation", { httpStatus: 400, code: "VALIDATION_FAILED", ...opts });
    }
}
exports.ValidationError = ValidationError;
class BusinessError extends AppError {
    constructor(message, opts = {}) {
        super(message, "business", { httpStatus: 409, code: "BUSINESS_RULE_VIOLATION", ...opts });
    }
}
exports.BusinessError = BusinessError;
class InfrastructureError extends AppError {
    constructor(message, opts = {}) {
        super(message, "infrastructure", { httpStatus: 502, code: "INFRASTRUCTURE_ERROR", isOperational: false, ...opts });
    }
}
exports.InfrastructureError = InfrastructureError;
/* ── Atajos comunes (subtipos con status/codes convencionales) ───────────── */
class NotFoundError extends BusinessError {
    constructor(message = "Recurso no encontrado", opts = {}) {
        super(message, { httpStatus: 404, code: "NOT_FOUND", ...opts });
    }
}
exports.NotFoundError = NotFoundError;
class UnauthorizedError extends AppError {
    constructor(message = "No autenticado", opts = {}) {
        super(message, "validation", { httpStatus: 401, code: "UNAUTHORIZED", ...opts });
    }
}
exports.UnauthorizedError = UnauthorizedError;
class ForbiddenError extends AppError {
    constructor(message = "No autorizado", opts = {}) {
        super(message, "business", { httpStatus: 403, code: "FORBIDDEN", ...opts });
    }
}
exports.ForbiddenError = ForbiddenError;
class ConflictError extends BusinessError {
    constructor(message = "Conflicto de estado", opts = {}) {
        super(message, { httpStatus: 409, code: "CONFLICT", ...opts });
    }
}
exports.ConflictError = ConflictError;
class ExternalServiceError extends InfrastructureError {
    constructor(message = "Servicio externo no disponible", opts = {}) {
        super(message, { httpStatus: 502, code: "EXTERNAL_SERVICE_ERROR", ...opts });
    }
}
exports.ExternalServiceError = ExternalServiceError;
/* ── Clasificación de lo desconocido ─────────────────────────────────────── */
function isAppError(err) {
    return err instanceof AppError;
}
/**
 * Convierte cualquier `unknown` en un AppError. Lo que no reconozca se trata como
 * fallo de infraestructura inesperado (500), nunca se ignora.
 *
 * El `message` del AppError devuelto conserva el texto original SOLO para logging; lo que se
 * envía al cliente lo decide `toErrorResponse` (que lo reemplaza por "Error interno").
 */
function classifyUnknownError(err) {
    if (isAppError(err))
        return err;
    const message = err instanceof Error ? err.message : String(err);
    return new InfrastructureError(message, {
        httpStatus: 500,
        code: "UNEXPECTED_ERROR",
        isOperational: false,
        cause: err,
    });
}
/** Mensaje genérico que ve el cliente cuando el error no es operacional y es 5xx. */
exports.GENERIC_ERROR_MESSAGE = "Error interno";
/**
 * Cuerpo JSON uniforme y seguro para responder al cliente.
 *
 * Desde 0.8.0: un error NO operacional con status >= 500 (excepciones desconocidas, fallos de
 * infraestructura) responde `error: "Error interno"` en vez de su mensaje: ese texto suele traer
 * internals (hosts, SQL, URLs con claves). El mensaje real queda en el log (redactado) y el
 * cliente correlaciona por `requestId`; tampoco se envía `details`. Los operacionales y los 4xx conservan mensaje y details.
 */
function toErrorResponse(err, requestId) {
    const appErr = classifyUnknownError(err);
    const masked = !appErr.isOperational && appErr.httpStatus >= 500;
    return {
        status: appErr.httpStatus,
        body: {
            error: masked ? exports.GENERIC_ERROR_MESSAGE : appErr.message,
            code: appErr.code,
            category: appErr.category,
            ...(requestId ? { requestId } : {}),
            ...(!masked && appErr.details !== undefined ? { details: appErr.details } : {}),
        },
    };
}
