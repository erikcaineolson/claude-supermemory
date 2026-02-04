/**
 * Validation and integrity checking utilities
 */

import { createHash, createHmac } from 'node:crypto';

// ============================================================================
// API KEY VALIDATION
// ============================================================================

/**
 * Validate API key format
 * @param {string} key
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateApiKeyFormat(key) {
  if (!key || typeof key !== 'string') {
    return { valid: false, reason: 'key is empty or not a string' };
  }
  if (!key.startsWith('sm_')) {
    return { valid: false, reason: 'key must start with sm_ prefix' };
  }
  if (key.length < 20) {
    return { valid: false, reason: 'key is too short' };
  }
  if (/\s/.test(key)) {
    return { valid: false, reason: 'key contains whitespace' };
  }
  return { valid: true };
}

// ============================================================================
// CONTAINER TAG VALIDATION
// ============================================================================

/**
 * Validate container tag format
 * @param {string} tag
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateContainerTag(tag) {
  if (!tag || typeof tag !== 'string') {
    return { valid: false, reason: 'tag is empty' };
  }
  if (tag.length > 100) {
    return { valid: false, reason: 'tag exceeds 100 characters' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(tag)) {
    return {
      valid: false,
      reason: 'tag contains invalid characters (only alphanumeric, underscore, hyphen allowed)',
    };
  }
  if (/^[-_]|[-_]$/.test(tag)) {
    return { valid: false, reason: 'tag must not start or end with - or _' };
  }
  return { valid: true };
}

// ============================================================================
// CONTENT SANITIZATION
// ============================================================================

const CONTROL_CHAR_PATTERNS = [
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
  /\uFEFF/g,
  /[\uFFF0-\uFFFF]/g,
];

/**
 * Sanitize content by removing control characters and enforcing max length
 * @param {string} content
 * @param {number} maxLength
 * @returns {string}
 */
export function sanitizeContent(content, maxLength = 100000) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  let sanitized = content;
  for (const pattern of CONTROL_CHAR_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }

  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  return sanitized;
}

/**
 * Validate content length
 * @param {string} content
 * @param {number} minLength
 * @param {number} maxLength
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateContentLength(content, minLength = 1, maxLength = 100000) {
  if (content.length < minLength) {
    return { valid: false, reason: `content below minimum length (${minLength})` };
  }
  if (content.length > maxLength) {
    return { valid: false, reason: `content exceeds maximum length (${maxLength})` };
  }
  return { valid: true };
}

// ============================================================================
// METADATA SANITIZATION
// ============================================================================

const MAX_METADATA_KEYS = 50;
const MAX_KEY_LENGTH = 128;
const MAX_VALUE_LENGTH = 1024;

/**
 * Sanitize metadata object
 * @param {object} metadata
 * @returns {object}
 */
export function sanitizeMetadata(metadata) {
  const sanitized = {};
  let count = 0;

  for (const [key, value] of Object.entries(metadata)) {
    if (count >= MAX_METADATA_KEYS) break;
    if (key.length > MAX_KEY_LENGTH) continue;
    if (/[^\w.-]/.test(key)) continue;

    if (typeof value === 'string') {
      sanitized[key] = value.slice(0, MAX_VALUE_LENGTH);
      count++;
    } else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') {
      sanitized[key] = value;
      count++;
    }
  }

  return sanitized;
}

// ============================================================================
// RECALL CONFIG VALIDATION
// ============================================================================

/**
 * Validate recall configuration parameters
 * @param {number} maxRecallResults
 * @param {number} profileFrequency
 * @returns {string[]} Array of validation errors
 */
export function validateRecallConfig(maxRecallResults, profileFrequency) {
  const errors = [];
  if (!Number.isInteger(maxRecallResults) || maxRecallResults < 1 || maxRecallResults > 20) {
    errors.push('maxRecallResults must be an integer between 1 and 20');
  }
  if (!Number.isInteger(profileFrequency) || profileFrequency < 1 || profileFrequency > 500) {
    errors.push('profileFrequency must be an integer between 1 and 500');
  }
  return errors;
}

// ============================================================================
// REQUEST INTEGRITY
// ============================================================================

const INTEGRITY_VERSION = 1;

/**
 * Create SHA-256 hash of a string
 * @param {string} data
 * @returns {string}
 */
function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Derive HMAC secret from API key
 * This eliminates the need for a hardcoded shared secret.
 * The secret is unique per user since it's derived from their API key.
 * @param {string} apiKey
 * @returns {string}
 */
function deriveHmacSecret(apiKey) {
  // Use a key derivation approach: hash the API key with a fixed context string
  // This produces a unique secret per API key without storing a shared secret
  return createHash('sha256')
    .update(`supermemory-integrity-v${INTEGRITY_VERSION}:${apiKey}`)
    .digest('hex');
}

/**
 * Create HMAC signature for request integrity
 * @param {string} apiKey
 * @param {string} containerTag
 * @returns {string}
 */
function createIntegritySignature(apiKey, containerTag) {
  const secret = deriveHmacSecret(apiKey);
  const payload = [sha256(apiKey), sha256(containerTag), INTEGRITY_VERSION].join(':');
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Get request integrity headers
 * @param {string} apiKey
 * @param {string} containerTag
 * @returns {{[key: string]: string}}
 */
export function getRequestIntegrity(apiKey, containerTag) {
  const contentHash = sha256(containerTag);
  const signature = createIntegritySignature(apiKey, containerTag);

  return {
    'X-Content-Hash': contentHash,
    'X-Request-Integrity': `v${INTEGRITY_VERSION}.${signature}`,
  };
}
