// @ts-check
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StageConfigError } from '../errors/index.js';
import { crossCheckStages } from './cross-checks.js';
import { parseStage } from './parse-stage.js';

/** @import { StageDefinition } from './types.js' */
/** @import { StageConfigIssue } from '../errors/index.js' */
/** @import { SourcedStage } from './cross-checks.js' */

const STAGE_FILE_EXTENSION = '.yaml';
const ROOT_PATH = '(root)';

/**
 * List the stage files in a directory, sorted by name.
 * @param {string} dir Stages directory.
 * @returns {Promise<string[]>} File names ending in `.yaml`.
 * @throws {StageConfigError} When the directory cannot be read or holds no stage files.
 */
async function listStageFiles(dir) {
  /** @type {string[]} */
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    const message = `Cannot read stages directory: ${error instanceof Error ? error.message : String(error)}`;
    throw new StageConfigError([{ source: dir, path: ROOT_PATH, message }], { cause: error });
  }
  const files = names
    .filter((name) => name.endsWith(STAGE_FILE_EXTENSION))
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) {
    throw new StageConfigError([
      { source: dir, path: ROOT_PATH, message: `No ${STAGE_FILE_EXTENSION} stage files found` },
    ]);
  }
  return files;
}

/**
 * Read one stage file.
 * @param {string} dir Stages directory.
 * @param {string} source File name.
 * @returns {Promise<string>} File contents.
 * @throws {StageConfigError} When the file cannot be read, naming the file.
 */
async function readStageFile(dir, source) {
  try {
    return await readFile(join(dir, source), 'utf8');
  } catch (error) {
    const message = `Cannot read stage file: ${error instanceof Error ? error.message : String(error)}`;
    throw new StageConfigError([{ source, path: ROOT_PATH, message }], { cause: error });
  }
}

/**
 * Load every stage file in a directory, validate each and the set as a whole.
 * @param {string} dir Stages directory, e.g. `config/stages`.
 * @returns {Promise<ReadonlyArray<Readonly<StageDefinition>>>} Stages sorted by `order`, frozen.
 * @throws {StageConfigError} Listing every problem in every file, naming the file and path.
 */
export async function loadStages(dir) {
  const files = await listStageFiles(dir);
  /** @type {SourcedStage[]} */
  const entries = [];
  /** @type {StageConfigIssue[]} */
  const issues = [];
  for (const source of files) {
    try {
      entries.push({ source, stage: parseStage(await readStageFile(dir, source), source) });
    } catch (error) {
      if (!(error instanceof StageConfigError)) {
        throw error;
      }
      issues.push(...error.issues);
    }
  }
  entries.sort((a, b) => a.stage.order - b.stage.order);
  issues.push(...crossCheckStages(entries));
  if (issues.length > 0) {
    throw new StageConfigError(issues);
  }
  return Object.freeze(entries.map((entry) => entry.stage));
}
