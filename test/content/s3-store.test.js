// @ts-check
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { ContentIntegrityError, NotFoundError } from '../../src/errors/index.js';
import { createS3ContentStore } from '../../src/content/index.js';
import { contentHash } from '../../src/workflow/index.js';

const BUCKET = 'artifacts-test';

/**
 * An S3-shaped error as the SDK throws it.
 * @param {string} name Error name.
 * @param {number} status HTTP status.
 * @returns {Error} The error.
 */
function s3Error(name, status) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

/**
 * Hand-written S3 client double: an in-memory bucket honouring IfNoneMatch, plus scripted failures.
 * @param {{ failures?: Error[], emptyBody?: boolean }} [options] Errors to throw from the next
 *   sends, in order; and whether GetObject returns no body.
 */
function fakeS3({ failures = [], emptyBody = false } = {}) {
  /** @type {Map<string, string>} */
  const objects = new Map();
  /** @type {unknown[]} */
  const commands = [];
  const queue = [...failures];
  return {
    objects,
    commands,
    /**
     * Handle one command.
     * @param {PutObjectCommand | GetObjectCommand} command SDK command.
     * @returns {Promise<import('../../src/content/s3-store.js').S3Output>} SDK-shaped output.
     */
    async send(command) {
      commands.push(command);
      const failure = queue.shift();
      if (failure !== undefined) {
        throw failure;
      }
      if (command instanceof PutObjectCommand) {
        const { Key, Body, IfNoneMatch } = command.input;
        if (IfNoneMatch === '*' && objects.has(String(Key))) {
          throw s3Error('PreconditionFailed', 412);
        }
        objects.set(String(Key), String(Body));
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const body = objects.get(String(command.input.Key));
        if (emptyBody) {
          return {};
        }
        if (body === undefined) {
          throw s3Error('NoSuchKey', 404);
        }
        return { Body: { transformToString: async () => body } };
      }
      throw new Error('unexpected command');
    },
  };
}

describe('createS3ContentStore', () => {
  it('puts content under its hash key, only if absent, in the configured bucket', async () => {
    const client = fakeS3();
    const store = createS3ContentStore({ client, bucket: BUCKET });

    const { key, hash } = await store.put('# Brief');

    expect(hash).toBe(contentHash('# Brief'));
    expect(key).toBe(`sha256/${hash}`);
    expect(client.commands[0]).toBeInstanceOf(PutObjectCommand);
    expect(/** @type {PutObjectCommand} */ (client.commands[0]).input).toMatchObject({
      Bucket: BUCKET,
      Key: key,
      Body: '# Brief',
      IfNoneMatch: '*',
    });
  });

  it('treats an existing object (412) as a no-op', async () => {
    const client = fakeS3();
    const store = createS3ContentStore({ client, bucket: BUCKET });

    const first = await store.put('same');
    const second = await store.put('same');

    expect(second).toEqual(first);
    expect(client.objects.size).toBe(1);
  });

  it('retries a conflicting concurrent write (409)', async () => {
    const client = fakeS3({ failures: [s3Error('ConditionalRequestConflict', 409)] });
    const store = createS3ContentStore({ client, bucket: BUCKET });

    const { key } = await store.put('x');

    expect(client.objects.get(key)).toBe('x');
    expect(client.commands).toHaveLength(2);
  });

  it('gives up after repeated conflicts', async () => {
    const conflict = () => s3Error('ConditionalRequestConflict', 409);
    const client = fakeS3({ failures: [conflict(), conflict(), conflict()] });
    const store = createS3ContentStore({ client, bucket: BUCKET });

    await expect(store.put('x')).rejects.toThrow('ConditionalRequestConflict');
  });

  it('rethrows other put errors', async () => {
    const client = fakeS3({ failures: [s3Error('AccessDenied', 403)] });

    await expect(createS3ContentStore({ client, bucket: BUCKET }).put('x')).rejects.toThrow(
      'AccessDenied',
    );
  });

  it('reads back stored content', async () => {
    const store = createS3ContentStore({ client: fakeS3(), bucket: BUCKET });
    const { key } = await store.put('hello');

    expect(await store.get(key)).toBe('hello');
  });

  it('throws NotFoundError for a missing object', async () => {
    const store = createS3ContentStore({ client: fakeS3(), bucket: BUCKET });

    await expect(store.get(`sha256/${'0'.repeat(64)}`)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError for a malformed key without calling S3', async () => {
    const client = fakeS3();

    await expect(createS3ContentStore({ client, bucket: BUCKET }).get('x/../y')).rejects.toThrow(
      NotFoundError,
    );
    expect(client.commands).toEqual([]);
  });

  it('throws ContentIntegrityError when the object does not match its key', async () => {
    const client = fakeS3();
    const store = createS3ContentStore({ client, bucket: BUCKET });
    const { key } = await store.put('original');
    client.objects.set(key, 'tampered');

    await expect(store.get(key)).rejects.toThrow(ContentIntegrityError);
  });

  it('throws NotFoundError when S3 returns no body', async () => {
    const store = createS3ContentStore({ client: fakeS3({ emptyBody: true }), bucket: BUCKET });

    await expect(store.get(`sha256/${'0'.repeat(64)}`)).rejects.toThrow(NotFoundError);
  });

  it('rethrows other get errors', async () => {
    const client = fakeS3({ failures: [s3Error('AccessDenied', 403)] });

    await expect(
      createS3ContentStore({ client, bucket: BUCKET }).get(`sha256/${'0'.repeat(64)}`),
    ).rejects.toThrow('AccessDenied');
  });
});
