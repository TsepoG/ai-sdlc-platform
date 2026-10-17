// @ts-check
import { STATUS_CODES } from 'node:http';
import { AppError } from '../errors/index.js';

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const INTERNAL_MESSAGE = 'Internal server error';

/**
 * @typedef {object} ErrorBody
 * @property {{ code: string, message: string }} error Client-facing error description.
 */

/**
 * Turn any thrown value into the status and body a client may see. Internals (stack, cause,
 * messages of 5xx errors) stay in the logs.
 * @param {Error & { statusCode?: number, code?: string }} error Error raised by a handler or Fastify.
 * @returns {{ statusCode: number, body: ErrorBody }} Response to send.
 */
export function toErrorResponse(error) {
  if (error instanceof AppError && error.statusCode < HTTP_SERVER_ERROR) {
    return {
      statusCode: error.statusCode,
      body: { error: { code: error.code, message: error.message } },
    };
  }
  const status = error.statusCode;
  if (!(error instanceof AppError) && status !== undefined && isClientError(status)) {
    return {
      statusCode: status,
      body: {
        error: {
          code: error.code ?? 'BAD_REQUEST',
          message: STATUS_CODES[status] ?? 'Bad request',
        },
      },
    };
  }
  return {
    statusCode: HTTP_SERVER_ERROR,
    body: { error: { code: 'INTERNAL_ERROR', message: INTERNAL_MESSAGE } },
  };
}

/**
 * Check whether a status is a 4xx client error.
 * @param {number} status HTTP status code.
 * @returns {boolean} True for 400-499.
 */
function isClientError(status) {
  return status >= HTTP_BAD_REQUEST && status < HTTP_SERVER_ERROR;
}

/**
 * Fastify error handler: logs the error with the request's logger and replies with a safe body.
 * @param {Error & { statusCode?: number, code?: string }} error Error raised by a handler or Fastify.
 * @param {import('fastify').FastifyRequest} request Failing request.
 * @param {import('fastify').FastifyReply} reply Reply to send.
 * @returns {import('fastify').FastifyReply} The reply, for chaining.
 */
export function errorHandler(error, request, reply) {
  const { statusCode, body } = toErrorResponse(error);
  if (statusCode >= HTTP_SERVER_ERROR) {
    request.log.error({ err: error }, 'request failed');
  } else {
    request.log.warn({ err: error, statusCode }, 'request rejected');
  }
  return reply.status(statusCode).send(body);
}

/**
 * Fastify not-found handler with the same body shape as other errors.
 * @param {import('fastify').FastifyRequest} _request Unmatched request.
 * @param {import('fastify').FastifyReply} reply Reply to send.
 * @returns {import('fastify').FastifyReply} The reply, for chaining.
 */
export function notFoundHandler(_request, reply) {
  return reply
    .status(HTTP_NOT_FOUND)
    .send({ error: { code: 'NOT_FOUND', message: STATUS_CODES[HTTP_NOT_FOUND] } });
}
