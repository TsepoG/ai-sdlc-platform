// @ts-check
import { parse } from 'yaml';
import { z } from 'zod';
import { RoutingError } from '../errors/index.js';

/** @import { ModelProvider } from './contracts.js' */

/** `${NAME}` placeholders; names follow environment-variable conventions. */
const VARIABLE_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

const routeSchema = z.strictObject({
  provider: z.string().min(1),
  model: z.string().min(1),
});

const routingSchema = z.strictObject({
  default: routeSchema,
  fallback: routeSchema,
  stages: z.record(z.string(), routeSchema).default({}),
});

/**
 * @typedef {object} Route
 * @property {string} provider Provider ID, matching a registered ModelProvider's `id`.
 * @property {string} model Model ID passed to the provider.
 */

/**
 * @typedef {object} Routing
 * @property {Readonly<Route>} default Route for stages without their own.
 * @property {Readonly<Route>} fallback Route used when a route's provider is not registered.
 * @property {Readonly<Record<string, Readonly<Route>>>} stages Routes by stage key.
 */

/**
 * @typedef {object} ResolvedRoute
 * @property {ModelProvider} provider Provider to call.
 * @property {string} model Model ID to request.
 */

/**
 * @typedef {object} ProviderRegistry
 * @property {(provider: ModelProvider) => void} register Add a provider under its `id`.
 * @property {(stageKey: string) => ResolvedRoute} resolve Provider and model for a stage.
 * @property {(stageKey: string) => ResolvedRoute} resolveFallback Fallback provider and model.
 */

/**
 * Replace every `${NAME}` in the string values of parsed YAML. Expanding after parsing means a
 * variable's value is always data and can never change the YAML structure.
 * @param {unknown} value Parsed YAML value.
 * @param {Readonly<Record<string, string | undefined>>} vars Variables to substitute.
 * @returns {unknown} The value with variables expanded.
 * @throws {RoutingError} When a referenced variable is missing or empty.
 */
function expandVariables(value, vars) {
  if (typeof value === 'string') {
    return value.replace(VARIABLE_PATTERN, (_match, /** @type {string} */ name) => {
      const replacement = Object.hasOwn(vars, name) ? vars[name] : undefined;
      if (replacement === undefined || replacement === '') {
        throw new RoutingError(`Routing references the variable ${name}, which is not set`);
      }
      return replacement;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandVariables(item, vars));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, expandVariables(child, vars)]),
    );
  }
  return value;
}

/**
 * Parse and validate `config/routing.yaml`, expanding `${NAME}` from the injected variables.
 * @param {string} text YAML text.
 * @param {Readonly<Record<string, string | undefined>>} vars Variables for `${NAME}`; the caller
 *   passes them in (from src/config), so this never reads the process environment.
 * @returns {Readonly<Routing>} Validated, frozen routing.
 * @throws {RoutingError} When the YAML is malformed, a variable is missing or the shape is invalid.
 */
export function parseRouting(text, vars) {
  /** @type {unknown} */
  let document;
  try {
    document = parse(text);
  } catch (error) {
    throw new RoutingError('Routing configuration is not valid YAML', { cause: error });
  }
  const result = routingSchema.safeParse(expandVariables(document, vars));
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new RoutingError(`Invalid routing configuration: ${problems}`, { cause: result.error });
  }
  const { stages, ...routes } = result.data;
  return Object.freeze({
    default: Object.freeze(routes.default),
    fallback: Object.freeze(routes.fallback),
    stages: Object.freeze(
      Object.fromEntries(Object.entries(stages).map(([key, route]) => [key, Object.freeze(route)])),
    ),
  });
}

/**
 * Create a registry that maps stages to registered providers using the routing.
 * @param {Readonly<Routing>} routing Validated routing.
 * @returns {ProviderRegistry} Registry.
 */
export function createProviderRegistry(routing) {
  /** @type {Map<string, ModelProvider>} */
  const providers = new Map();

  /**
   * Provider and model for the fallback route.
   * @param {string} stageKey Stage asking, for the error message.
   * @returns {ResolvedRoute} Fallback provider and model.
   * @throws {RoutingError} When the fallback provider is not registered.
   */
  function resolveFallback(stageKey) {
    const { provider: id, model } = routing.fallback;
    const provider = providers.get(id);
    if (provider === undefined) {
      throw new RoutingError(
        `No provider registered for stage "${stageKey}": fallback provider "${id}" is not registered`,
      );
    }
    return { provider, model };
  }

  return {
    register(provider) {
      if (providers.has(provider.id)) {
        throw new RoutingError(`A provider with id "${provider.id}" is already registered`);
      }
      providers.set(provider.id, provider);
    },
    resolve(stageKey) {
      const route = Object.hasOwn(routing.stages, stageKey)
        ? routing.stages[stageKey]
        : routing.default;
      const provider = providers.get(route.provider);
      return provider === undefined ? resolveFallback(stageKey) : { provider, model: route.model };
    },
    resolveFallback,
  };
}
