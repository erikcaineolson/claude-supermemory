/**
 * Client Factory
 *
 * Automatically selects between local backend and Supermemory cloud
 * based on environment configuration.
 */

const { LocalMemoryClient, isLocalBackend } = require('./local-client.js');
const { loadSettings, getApiKey } = require('./settings.js');

/**
 * Create the appropriate memory client based on configuration.
 *
 * Uses local backend if:
 * - SUPERMEMORY_API_URL points to localhost/127.0.0.1
 * - SUPERMEMORY_LOCAL=true is set
 *
 * Otherwise uses Supermemory cloud (requires API key).
 */
function createClient(containerTag) {
  if (isLocalBackend()) {
    console.error('Supermemory: Using local backend');
    return new LocalMemoryClient(containerTag);
  }

  // Cloud backend - requires SDK and API key
  const { SupermemoryClient } = require('./supermemory-client.js');
  const settings = loadSettings();
  const apiKey = getApiKey(settings);
  return new SupermemoryClient(apiKey, containerTag);
}

/**
 * Check if the memory backend is available.
 * For local: checks if server is responding
 * For cloud: checks if API key is configured
 */
async function isBackendAvailable() {
  if (isLocalBackend()) {
    try {
      const apiUrl =
        process.env.SUPERMEMORY_API_URL || 'http://127.0.0.1:19877';
      const res = await fetch(`${apiUrl}/health`, { timeout: 2000 });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Cloud backend
  try {
    const settings = loadSettings();
    getApiKey(settings);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  createClient,
  isBackendAvailable,
  isLocalBackend,
};
