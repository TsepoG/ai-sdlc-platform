// @ts-check
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { NotFoundError } from '../errors/index.js';
import { assertContentKey, prepareContent, verifyContent } from './keys.js';

/** @import { ContentStore } from './types.js' */

const HTTP_NOT_FOUND = 404;
const HTTP_PRECONDITION_FAILED = 412;
const HTTP_CONFLICT = 409;
const MAX_PUT_ATTEMPTS = 3;
const CONTENT_TYPE = 'text/plain; charset=utf-8';

/**
 * @typedef {object} S3Output
 * @property {{ transformToString: (encoding?: string) => Promise<string> }} [Body] Object body (GetObject).
 */

/**
 * @typedef {object} S3Like
 * @property {(command: PutObjectCommand | GetObjectCommand) => Promise<S3Output>} send Send a Put or
 *   Get command; the S3Client shape, narrowed to what this store uses.
 */

/**
 * HTTP status of an SDK error, if it has one.
 * @param {unknown} error Thrown value.
 * @returns {number | undefined} Status code.
 */
function statusOf(error) {
  return /** @type {{ $metadata?: { httpStatusCode?: number } }} */ (error)?.$metadata
    ?.httpStatusCode;
}

/**
 * Create a content store backed by an S3 bucket. Writes use `If-None-Match: *`, so content is
 * written once and never overwritten.
 * @param {{ client: S3Like, bucket: string }} options S3 client and bucket name.
 * @returns {ContentStore} The store.
 */
export function createS3ContentStore({ client, bucket }) {
  return {
    kind: 's3',
    async put(content) {
      const { text, hash, key } = prepareContent(content);
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: text,
        ContentType: CONTENT_TYPE,
        IfNoneMatch: '*',
      });
      for (let attempt = 1; ; attempt += 1) {
        try {
          await client.send(command);
          return { key, hash };
        } catch (error) {
          const status = statusOf(error);
          if (status === HTTP_PRECONDITION_FAILED) {
            return { key, hash };
          }
          // S3 asks callers to retry a 409 from a concurrent conditional write.
          if (status !== HTTP_CONFLICT || attempt >= MAX_PUT_ATTEMPTS) {
            throw error;
          }
        }
      }
    },
    async get(key) {
      assertContentKey(key);
      try {
        const output = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (output.Body === undefined) {
          throw new NotFoundError('No content exists under that key');
        }
        return verifyContent(key, await output.Body.transformToString('utf-8'));
      } catch (error) {
        if (statusOf(error) === HTTP_NOT_FOUND) {
          throw new NotFoundError('No content exists under that key', { cause: error });
        }
        throw error;
      }
    },
  };
}
