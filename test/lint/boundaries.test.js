// @ts-check
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

/**
 * Lint a snippet as if it lived at `filePath` and return the messages for one rule.
 * @param {string} code Source to lint.
 * @param {string} filePath Repo-relative path the source pretends to live at.
 * @param {string} ruleId Rule whose messages to return.
 * @returns {Promise<import('eslint').Linter.LintMessage[]>} Messages for that rule.
 */
async function lintFor(code, filePath, ruleId) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === ruleId);
}

describe('AI vendor SDK import boundary', () => {
  it.each([
    '@anthropic-ai/sdk',
    'openai',
    '@google/genai',
    '@aws-sdk/client-bedrock-runtime',
    '@mistralai/mistralai',
    'cohere-ai',
  ])('rejects importing %s from outside the adapters folder', async (pkg) => {
    const code = `import x from '${pkg}';\nexport { x };\n`;

    const messages = await lintFor(code, 'src/workflow/x.js', 'no-restricted-imports');

    expect(messages).toHaveLength(1);
  });

  it('allows importing an AI vendor SDK from src/ai-adapters/<vendor>/', async () => {
    const code = "import x from '@anthropic-ai/sdk';\nexport { x };\n";

    const messages = await lintFor(code, 'src/ai-adapters/anthropic/x.js', 'no-restricted-imports');

    expect(messages).toHaveLength(0);
  });
});

describe('process.env boundary', () => {
  it('rejects process.env outside src/config', async () => {
    const code = 'export const v = process.env.PORT;\n';

    const messages = await lintFor(code, 'src/server/x.js', 'n/no-process-env');

    expect(messages).toHaveLength(1);
  });

  it('rejects importing env from node:process outside src/config', async () => {
    const code = "import { env } from 'node:process';\nexport { env };\n";

    const messages = await lintFor(code, 'src/server/x.js', 'no-restricted-imports');

    expect(messages).toHaveLength(1);
  });

  it('allows process.env inside src/config', async () => {
    const code = 'export const v = process.env.PORT;\n';

    const messages = await lintFor(code, 'src/config/x.js', 'n/no-process-env');

    expect(messages).toHaveLength(0);
  });

  it('still rejects env imports from node:process inside the adapters folder', async () => {
    const code = "import { env } from 'node:process';\nexport { env };\n";

    const messages = await lintFor(code, 'src/ai-adapters/anthropic/x.js', 'no-restricted-imports');

    expect(messages).toHaveLength(1);
  });
});

describe('console boundary', () => {
  it('rejects console.log in src', async () => {
    const messages = await lintFor("console.log('x');\n", 'src/server/x.js', 'no-console');

    expect(messages).toHaveLength(1);
  });
});
