/**
 * Supermemory SDK Client
 * Uses the official Supermemory SDK for all API operations
 */

const Supermemory = require('supermemory').default;

const DEFAULT_PROJECT_ID = 'sm_project_default';

class SupermemoryClient {
  constructor(apiKey, containerTag) {
    if (!apiKey) {
      throw new Error('SUPERMEMORY_API_KEY is required');
    }
    this.client = new Supermemory({
      apiKey,
      baseURL: 'https://api.supermemory.ai'
    });
    this.containerTag = containerTag || DEFAULT_PROJECT_ID;
  }

  /**
   * Add a new memory
   */
  async addMemory(content, containerTag, metadata = {}, customId = null) {
    const payload = {
      content,
      containerTag: containerTag || this.containerTag,
      metadata: {
        sm_source: 'claude-code-plugin',
        ...metadata
      }
    };

    if (customId) {
      payload.customId = customId;
    }

    const result = await this.client.add(payload);
    return {
      id: result.id,
      status: result.status,
      containerTag: containerTag || this.containerTag,
      sessionId: customId
    };
  }

  /**
   * Search memories semantically
   */
  async search(query, containerTag, options = {}) {
    const result = await this.client.search.memories({
      q: query,
      containerTag: containerTag || this.containerTag,
      limit: options.limit || 10,
      searchMode: options.searchMode || 'hybrid'
    });

    return {
      results: result.results.map(r => ({
        id: r.id,
        memory: r.content || r.memory || r.context || '',
        similarity: r.similarity,
        title: r.title,
        content: r.content
      })),
      total: result.total,
      timing: result.timing
    };
  }

  /**
   * Get user profile with optional query context
   */
  async getProfile(containerTag, query) {
    const result = await this.client.profile({
      containerTag: containerTag || this.containerTag,
      q: query
    });

    return {
      profile: {
        static: result.profile?.static || [],
        dynamic: result.profile?.dynamic || []
      },
      searchResults: result.searchResults ? {
        results: result.searchResults.results.map(r => ({
          id: r.id,
          memory: r.content || r.context || '',
          similarity: r.similarity,
          title: r.title
        })),
        total: result.searchResults.total,
        timing: result.searchResults.timing
      } : undefined
    };
  }

  /**
   * List recent memories
   */
  async listMemories(containerTag, limit = 20) {
    const result = await this.client.memories.list({
      containerTags: containerTag || this.containerTag,
      limit,
      order: 'desc',
      sort: 'createdAt'
    });
    return {
      memories: result.memories || result.results || []
    };
  }

  /**
   * Delete a memory
   */
  async deleteMemory(memoryId) {
    return this.client.memories.delete(memoryId);
  }
}

module.exports = { SupermemoryClient };
