// @ts-check
export { appendAuditEvent, chainHash, GENESIS_HASH } from './chain.js';
export { canonicalJson } from './canonical-json.js';
export { listAuditEvents } from './read.js';
export { verifyAuditChain } from './verify.js';
/** @typedef {import('./chain.js').AuditEventInput} AuditEventInput */
/** @typedef {import('./chain.js').AuditRecord} AuditRecord */
/** @typedef {import('./read.js').StoredAuditEvent} StoredAuditEvent */
/** @typedef {import('./verify.js').ChainVerification} ChainVerification */
/** @typedef {import('./verify.js').ChainBreak} ChainBreak */
