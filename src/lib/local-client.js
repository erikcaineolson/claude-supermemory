/**
 * Local Supermemory Client
 *
 * A drop-in replacement for SupermemoryClient that talks to the local backend.
 * Does not use the Supermemory SDK - makes direct HTTP calls to your local server.
 */

const {
  getSecureApiUrl,
  sanitizeContent,
  sanitizeQuery,
  sanitizeMetadata,
  auditLog,
} = require('./security.js');

// Rate limiter (shared with supermemory-client.js)
const RATE_LIMIT_MAX_CALLS = 100;
const RATE_LIMIT_WINDOW_MS = 60000;

class RateLimiter {
  constructor(maxCalls = RATE_LIMIT_MAX_CALLS, windowMs = RATE_LIMIT_WINDOW_MS) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
    this.calls = [];
  }

  check() {
    const now = Date.now();
    this.calls = this.calls.filter((t) => now - t < this.windowMs);
    if (this.calls.length >= this.maxCalls) {
      throw new Error(
        `Rate limit exceeded: ${this.maxCalls} calls per ${this.windowMs / 1000}s`,
      );
    }
    this.calls.push(now);
  }
}

/**
 * Check if we should use the local backend
 */
function isLocalBackend() {
  const apiUrl = process.env.SUPERMEMORY_API_URL || '';
  return (
    apiUrl.includes('localhost') ||
    apiUrl.includes('127.0.0.1') ||
    process.env.SUPERMEMORY_LOCAL === 'true'
  );
}

/**
 * Local client for self-hosted backend
 */
class LocalMemoryClient {
  constructor(containerTag) {
    this.baseUrl = getSecureApiUrl();
    this.containerTag = containerTag || 'claudecode_default';
    this.rateLimiter = new RateLimiter();
  }

  async request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Local backend error: ${res.status} ${text}`);
    }

    return res.json();
  }

  async addMemory(content, containerTag, metadata = {}, customId = null) {
    this.rateLimiter.check();

    // Sanitize content
    const sanitized = sanitizeContent(content);
    if (sanitized.redacted) {
      auditLog('content_redacted', { reason: 'sensitive data detected' });
    }
    if (sanitized.truncated) {
      auditLog('content_truncated', { originalLength: content.length });
    }

    // Sanitize metadata
    const safeMetadata = sanitizeMetadata({
      sm_source: 'claude-code-plugin-local',
      ...metadata,
    });

    const payload = {
      content: sanitized.content,
      containerTag: containerTag || this.containerTag,
      metadata: safeMetadata,
    };
    if (customId) payload.customId = customId;

    const result = await this.request('POST', '/add', payload);
    return {
      id: result.id,
      status: result.status,
      containerTag: containerTag || this.containerTag,
    };
  }

  async search(query, containerTag, options = {}) {
    this.rateLimiter.check();

    const safeQuery = sanitizeQuery(query);
    if (!safeQuery) {
      return { results: [], total: 0, timing: 0 };
    }

    const result = await this.request('POST', '/search/memories', {
      q: safeQuery,
      containerTag: containerTag || this.containerTag,
      limit: Math.min(options.limit || 10, 50),
    });

    return {
      results: (result.results || []).map((r) => ({
        id: r.id,
        memory: r.content || r.memory || '',
        similarity: r.similarity,
        title: r.title,
        content: r.content,
      })),
      total: result.total || 0,
      timing: result.timing || 0,
    };
  }

  async getProfile(containerTag, query) {
    this.rateLimiter.check();

    const safeQuery = query ? sanitizeQuery(query) : undefined;

    const result = await this.request('POST', '/profile', {
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
            results: (result.searchResults.results || []).map((r) => ({
              id: r.id,
              memory: r.content || r.memory || '',
              similarity: r.similarity,
              title: r.title,
            })),
            total: result.searchResults.total || 0,
            timing: result.searchResults.timing || 0,
          }
        : undefined,
    };
  }

  async listMemories(containerTag, limit = 20) {
    this.rateLimiter.check();

    const result = await this.request('POST', '/memories/list', {
      containerTags: containerTag || this.containerTag,
      limit,
      order: 'desc',
      sort: 'createdAt',
    });

    return { memories: result.memories || [] };
  }

  async deleteMemory(memoryId) {
    this.rateLimiter.check();
    return this.request('DELETE', `/memories/${memoryId}`);
  }
}

module.exports = {
  LocalMemoryClient,
  RateLimiter,
  isLocalBackend,
};
