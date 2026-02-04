const Supermemory = require('supermemory').default;
const {
  getRequestIntegrity,
  validateApiKeyFormat,
  validateContainerTag,
} = require('./validate.js');
const {
  getSecureApiUrl,
  sanitizeContent,
  sanitizeQuery,
  sanitizeMetadata,
  auditLog,
} = require('./security.js');

const DEFAULT_PROJECT_ID = 'claudecode_default';
// Use secure API URL validation - rejects untrusted hosts
const API_URL = getSecureApiUrl();

// Rate limiter configuration
const RATE_LIMIT_MAX_CALLS = 100;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMITER_COMPACT_THRESHOLD = 0.5; // Compact when valid calls < 50% of array

/**
 * Simple rate limiter to prevent API abuse.
 * Uses index-based pruning for efficiency.
 */
class RateLimiter {
  constructor(
    maxCalls = RATE_LIMIT_MAX_CALLS,
    windowMs = RATE_LIMIT_WINDOW_MS,
  ) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
    this.calls = [];
    this.firstValidIndex = 0;
  }

  check() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Find first valid index using index-based scan (more efficient than filter)
    while (
      this.firstValidIndex < this.calls.length &&
      this.calls[this.firstValidIndex] < windowStart
    ) {
      this.firstValidIndex++;
    }

    // Count valid calls
    const validCallCount = this.calls.length - this.firstValidIndex;

    // Compact array if ratio of valid calls drops below threshold
    if (
      this.calls.length > 100 &&
      validCallCount / this.calls.length < RATE_LIMITER_COMPACT_THRESHOLD
    ) {
      this.calls = this.calls.slice(this.firstValidIndex);
      this.firstValidIndex = 0;
    }

    if (validCallCount >= this.maxCalls) {
      throw new Error(
        `Rate limit exceeded: ${this.maxCalls} calls per ${this.windowMs / 1000}s`,
      );
    }

    this.calls.push(now);
  }
}

class SupermemoryClient {
  constructor(apiKey, containerTag) {
    if (!apiKey) throw new Error('SUPERMEMORY_CC_API_KEY is required');

    const keyCheck = validateApiKeyFormat(apiKey);
    if (!keyCheck.valid) {
      throw new Error(`Invalid API key: ${keyCheck.reason}`);
    }

    const tag = containerTag || DEFAULT_PROJECT_ID;
    const tagCheck = validateContainerTag(tag);
    if (!tagCheck.valid) {
      console.warn(`Container tag warning: ${tagCheck.reason}`);
    }

    const integrityHeaders = getRequestIntegrity(apiKey, tag);

    this.client = new Supermemory({
      apiKey,
      baseURL: API_URL,
      defaultHeaders: integrityHeaders,
    });
    this.containerTag = tag;
    this.rateLimiter = new RateLimiter();
  }

  async addMemory(content, containerTag, metadata = {}, customId = null) {
    this.rateLimiter.check();

    // Sanitize content - redact secrets and enforce size limits
    const sanitized = sanitizeContent(content);
    if (sanitized.redacted) {
      auditLog('content_redacted', { reason: 'sensitive data detected' });
    }
    if (sanitized.truncated) {
      auditLog('content_truncated', { originalLength: content.length });
    }

    // Sanitize metadata
    const safeMetadata = sanitizeMetadata({
      sm_source: 'claude-code-plugin',
      ...metadata,
    });

    const payload = {
      content: sanitized.content,
      containerTag: containerTag || this.containerTag,
      metadata: safeMetadata,
    };
    if (customId) payload.customId = customId;

    const result = await this.client.add(payload);
    return {
      id: result.id,
      status: result.status,
      containerTag: containerTag || this.containerTag,
    };
  }

  async search(query, containerTag, options = {}) {
    this.rateLimiter.check();

    // Sanitize query
    const safeQuery = sanitizeQuery(query);
    if (!safeQuery) {
      return { results: [], total: 0, timing: 0 };
    }

    const result = await this.client.search.memories({
      q: safeQuery,
      containerTag: containerTag || this.containerTag,
      limit: Math.min(options.limit || 10, 50), // Cap at 50 results
      searchMode: options.searchMode || 'hybrid',
    });
    return {
      results: result.results.map((r) => ({
        id: r.id,
        memory: r.content || r.memory || r.context || '',
        similarity: r.similarity,
        title: r.title,
        content: r.content,
      })),
      total: result.total,
      timing: result.timing,
    };
  }

  async getProfile(containerTag, query) {
    this.rateLimiter.check();

    // Sanitize query if provided
    const safeQuery = query ? sanitizeQuery(query) : undefined;

    const result = await this.client.profile({
      containerTag: containerTag || this.containerTag,
      q: safeQuery,
    });
    return {
      profile: {
        static: result.profile?.static || [],
        dynamic: result.profile?.dynamic || [],
      },
      searchResults: result.searchResults
        ? {
            results: result.searchResults.results.map((r) => ({
              id: r.id,
              memory: r.content || r.context || '',
              similarity: r.similarity,
              title: r.title,
            })),
            total: result.searchResults.total,
            timing: result.searchResults.timing,
          }
        : undefined,
    };
  }

  async listMemories(containerTag, limit = 20) {
    this.rateLimiter.check();
    const result = await this.client.memories.list({
      containerTags: containerTag || this.containerTag,
      limit,
      order: 'desc',
      sort: 'createdAt',
    });
    return { memories: result.memories || result.results || [] };
  }

  async deleteMemory(memoryId) {
    this.rateLimiter.check();
    return this.client.memories.delete(memoryId);
  }
}

module.exports = { SupermemoryClient, RateLimiter };
