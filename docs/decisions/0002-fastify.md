# 0002. Fastify as the API framework

**Status:** Proposed. Awaiting the owner's confirmation (listed as an open question in CLAUDE.md).

## Context

The platform needs an HTTP API for Initiatives, versions, review packages, decisions and a health check. The original plan proposed NestJS, which suits TypeScript decorators and dependency injection well. The project is JavaScript with JSDoc (see ADR 0001), where NestJS is a poor fit.

## Decision

Use Fastify (v5) for the API, with Zod for validating input at the boundary and pino for logging (Fastify's native logger).

Phase 00 implements it as `buildServer({ config, logger })`, an app factory that takes its dependencies as arguments. Request IDs, a shared error handler that maps `AppError` and a not-found handler are set up there. `GET /health` is the only route so far.

## Consequences

- Small core, plugin-based, fast, and `inject()` lets tests call routes without opening a port.
- Structured JSON logging with request IDs works without extra libraries.
- Fastify has no built-in dependency injection; the project uses plain factory arguments, which matches CODING_PRINCIPLES.md section 3.
- Fastify's own schema validation (JSON Schema) is not used; Zod is. Route handlers receive data already validated at the edge.
- The framework is isolated to `src/server`. If the owner prefers another, only that folder and its tests change; config, errors, logger and later domain code are unaffected.
- Not yet used: authentication, rate limiting and body-size policy. These arrive with SSO in a later phase.

If the owner rejects this, replace the status with _Rejected_, name the replacement, and update CLAUDE.md.
