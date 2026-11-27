// @ts-check
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const AI_DIR = join(import.meta.dirname, '../../src/ai');
const VENDOR_NAMES = /anthropic|claude|openai|bedrock|gemini|google|mistral|cohere/i;
const IMPORT_SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/g;

/**
 * Read every .js file under src/ai.
 * @returns {Promise<{ name: string, text: string }[]>} File names and contents.
 */
async function aiSources() {
  const names = (await readdir(AI_DIR, { recursive: true })).filter((name) => name.endsWith('.js'));
  return Promise.all(
    names.map(async (name) => ({ name, text: await readFile(join(AI_DIR, name), 'utf8') })),
  );
}

describe('src/ai stays vendor-neutral', () => {
  it('has source files to check', async () => {
    expect((await aiSources()).length).toBeGreaterThan(0);
  });

  it('imports only relative modules, node built-ins, zod and yaml', async () => {
    const allowed = /^(?:\.{1,2}\/|node:|zod$|yaml$)/;

    const offenders = (await aiSources()).flatMap(({ name, text }) =>
      [...text.matchAll(IMPORT_SPECIFIER)]
        .map((match) => match[1] ?? match[2])
        .filter((specifier) => !allowed.test(specifier))
        .map((specifier) => `${name}: ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it('never names an AI vendor', async () => {
    const offenders = (await aiSources())
      .filter(({ text }) => VENDOR_NAMES.test(text))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });
});
