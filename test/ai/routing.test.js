// @ts-check
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RoutingError } from '../../src/errors/index.js';
import { createProviderRegistry, createStubProvider, parseRouting } from '../../src/ai/index.js';

const ROUTING_YAML = `
default: { provider: primary, model: "\${DEFAULT_MODEL}" }
fallback: { provider: backup, model: backup-model }
stages:
  brief: { provider: primary, model: brief-model }
  build: { provider: other, model: build-model }
`;

const VARS = { DEFAULT_MODEL: 'default-model' };

describe('parseRouting', () => {
  it('parses routes and expands ${NAME} from the injected variables', () => {
    const routing = parseRouting(ROUTING_YAML, VARS);

    expect(routing.default).toEqual({ provider: 'primary', model: 'default-model' });
    expect(routing.stages.brief).toEqual({ provider: 'primary', model: 'brief-model' });
  });

  it('throws RoutingError naming a missing variable', () => {
    expect(() => parseRouting(ROUTING_YAML, {})).toThrow(RoutingError);
    expect(() => parseRouting(ROUTING_YAML, {})).toThrow(/DEFAULT_MODEL/);
  });

  it('treats an empty variable as missing', () => {
    expect(() => parseRouting(ROUTING_YAML, { DEFAULT_MODEL: '' })).toThrow(/DEFAULT_MODEL/);
  });

  it('does not read inherited properties as variables', () => {
    const inherited = Object.create({ DEFAULT_MODEL: 'inherited-model' });

    expect(() => parseRouting(ROUTING_YAML, inherited)).toThrow(/DEFAULT_MODEL/);
  });

  it('leaves text that is not a ${NAME} placeholder alone', () => {
    const text = 'default: { provider: p, model: "${lower}" }\nfallback: { provider: p, model: m }';

    expect(parseRouting(text, {}).default.model).toBe('${lower}');
  });

  it('expands variables inside a longer value', () => {
    const text = 'default: { provider: p, model: "m-${V}-x" }\nfallback: { provider: p, model: m }';

    expect(parseRouting(text, { V: '1' }).default.model).toBe('m-1-x');
  });

  it('checks variables inside lists too', () => {
    const text = `${ROUTING_YAML}\nnotes: ["\${MISSING_NOTE}"]`;

    expect(() => parseRouting(text, VARS)).toThrow(/MISSING_NOTE/);
  });

  it('defaults stages to none', () => {
    const text = 'default: { provider: p, model: m }\nfallback: { provider: p, model: m }';

    expect(parseRouting(text, {}).stages).toEqual({});
  });

  it('returns a frozen routing', () => {
    expect(Object.isFrozen(parseRouting(ROUTING_YAML, VARS).default)).toBe(true);
  });

  it('throws RoutingError for malformed YAML', () => {
    expect(() => parseRouting('default: [', VARS)).toThrow(RoutingError);
  });

  it.each([
    ['a missing fallback', 'default: { provider: p, model: m }'],
    [
      'an unknown key',
      'default: { provider: p, model: m }\nfallback: { provider: p, model: m }\nextra: 1',
    ],
    ['an empty model', 'default: { provider: p, model: "" }\nfallback: { provider: p, model: m }'],
  ])('throws RoutingError naming the path for %s', (_name, text) => {
    expect(() => parseRouting(text, VARS)).toThrow(RoutingError);
  });

  it('parses the real config/routing.yaml with every stage on the stub', async () => {
    const text = await readFile(join(import.meta.dirname, '../../config/routing.yaml'), 'utf8');

    const routing = parseRouting(text, {});

    expect(Object.keys(routing.stages)).toHaveLength(7);
    for (const route of [routing.default, routing.fallback, ...Object.values(routing.stages)]) {
      expect(route).toEqual({ provider: 'stub', model: 'stub-model' });
    }
  });
});

describe('createProviderRegistry', () => {
  const routing = parseRouting(ROUTING_YAML, VARS);

  /**
   * A registry with the given provider IDs registered as stubs.
   * @param {string[]} ids Provider IDs.
   * @returns {ReturnType<typeof createProviderRegistry>} Registry.
   */
  function registryWith(ids) {
    const registry = createProviderRegistry(routing);
    for (const id of ids) {
      registry.register(createStubProvider({ id }));
    }
    return registry;
  }

  it('resolves the stage route', () => {
    const { provider, model } = registryWith(['primary', 'backup']).resolve('brief');

    expect(provider.id).toBe('primary');
    expect(model).toBe('brief-model');
  });

  it('resolves the default route for a stage without its own', () => {
    const { provider, model } = registryWith(['primary', 'backup']).resolve('test');

    expect(provider.id).toBe('primary');
    expect(model).toBe('default-model');
  });

  it('does not treat inherited properties as stage routes', () => {
    expect(registryWith(['primary']).resolve('constructor').model).toBe('default-model');
  });

  it('resolves the fallback when the route’s provider is not registered', () => {
    const { provider, model } = registryWith(['primary', 'backup']).resolve('build');

    expect(provider.id).toBe('backup');
    expect(model).toBe('backup-model');
  });

  it('resolves the fallback route directly', () => {
    const { provider, model } = registryWith(['primary', 'backup']).resolveFallback('brief');

    expect(provider.id).toBe('backup');
    expect(model).toBe('backup-model');
  });

  it('throws RoutingError when nothing is registered', () => {
    expect(() => registryWith([]).resolve('brief')).toThrow(RoutingError);
  });

  it('throws RoutingError when the fallback provider is not registered', () => {
    expect(() => registryWith(['primary']).resolveFallback('brief')).toThrow(RoutingError);
  });

  it('refuses to register two providers with the same id', () => {
    const registry = registryWith(['primary']);

    expect(() => registry.register(createStubProvider({ id: 'primary' }))).toThrow(RoutingError);
  });
});
