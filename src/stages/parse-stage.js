// @ts-check
import { parse } from 'yaml';
import { StageConfigError } from '../errors/index.js';
import { deepFreeze } from './deep-freeze.js';
import { stageSchema } from './schema.js';

/** @import { StageDefinition } from './types.js' */

const ROOT_PATH = '(root)';

/**
 * Parse one stage YAML document and validate it.
 * @param {string} text YAML text of the stage file.
 * @param {string} source File name, used in error messages.
 * @returns {Readonly<StageDefinition>} The validated, deeply frozen stage.
 * @throws {StageConfigError} When the YAML is malformed or any rule fails; lists every failing path.
 */
export function parseStage(text, source) {
  /** @type {unknown} */
  let document;
  try {
    document = parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StageConfigError([{ source, path: ROOT_PATH, message }], { cause: error });
  }
  const result = stageSchema.safeParse(document);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      source,
      path: issue.path.map(String).join('.') || ROOT_PATH,
      message: issue.message,
    }));
    throw new StageConfigError(issues, { cause: result.error });
  }
  return deepFreeze(/** @type {StageDefinition} */ (result.data));
}
