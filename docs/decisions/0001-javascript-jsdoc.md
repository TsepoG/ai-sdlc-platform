# 0001. JavaScript with JSDoc types

**Status:** Accepted

## Context

The original plan proposed a TypeScript stack. The design docs still show some interfaces in TypeScript notation. The owner prefers to write plain JavaScript, and the platform should still catch type errors in CI.

## Decision

Write all source in JavaScript as ES modules (`"type": "module"`). Describe types with JSDoc (`@typedef`, `@param`, `@returns`, `@import`) and check them with `tsc --noEmit` using `checkJs` and `strict`. Every file starts with `// @ts-check`. A type error fails `npm run typecheck`, and therefore CI.

TypeScript is a development dependency only (the checker); there are no `.ts` source files and no build step. The same rule applies to `infra/` (AWS CDK in JavaScript).

## Consequences

- No transpile step: what runs is what is written, and the container copies `src/` as is.
- Type definitions in the design docs are implemented as JSDoc typedefs; the shapes are binding, the notation is not.
- Some TypeScript idioms (generics, complex mapped types) are more awkward in JSDoc. Keep types simple, and prefer small modules with clear shapes.
- ESLint (`eslint-plugin-jsdoc`) requires JSDoc on every export, so the documentation and the types stay together.
- TypeScript is pinned to 6.0.x for now, because the ESLint tooling that reads the JSDoc types declares support only below 6.1. Revisit when that range allows 7.
- Reversing this decision means converting files to `.ts`, which is a large change; record a new ADR before doing so.
