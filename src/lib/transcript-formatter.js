const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const MAX_TOOL_RESULT_LENGTH = 500;
const SKIP_RESULT_TOOLS = ['Read'];
const TRACKER_DIR = path.join(os.homedir(), '.supermemory-claude', 'trackers');

let toolUseMap = new Map();

/**
 * Sanitize session ID to prevent path traversal attacks.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
function sanitizeSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Invalid session ID: must be a non-empty string');
  }
  // Only allow alphanumeric, hyphen, underscore
  const sanitized = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (sanitized.length === 0) {
    throw new Error('Invalid session ID: contains no valid characters');
  }
  if (sanitized !== sessionId) {
    // Log warning but don't expose original session ID (may contain sensitive data)
    console.error(
      `Warning: Session ID contained invalid characters and was sanitized`,
    );
  }
  return sanitized;
}

async function ensureTrackerDir() {
  try {
    await fsPromises.mkdir(TRACKER_DIR, { recursive: true, mode: 0o700 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

/**
 * Get tracker data (uuid and offset) for a session
 * @param {string} sessionId
 * @returns {Promise<{uuid: string|null, offset: number}>}
 */
async function getTrackerData(sessionId) {
  await ensureTrackerDir();
  const safeSessionId = sanitizeSessionId(sessionId);
  const trackerFile = path.join(TRACKER_DIR, `${safeSessionId}.json`);

  try {
    const content = await fsPromises.readFile(trackerFile, 'utf-8');
    const data = JSON.parse(content);
    return {
      uuid: data.uuid || null,
      offset: typeof data.offset === 'number' ? data.offset : 0,
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      if (process.env.SUPERMEMORY_DEBUG === 'true') {
        console.error(`Failed to read tracker file: ${err.message}`);
      }
    }
  }

  // Check for legacy .txt tracker file and migrate
  const legacyFile = path.join(TRACKER_DIR, `${safeSessionId}.txt`);
  try {
    const uuid = (await fsPromises.readFile(legacyFile, 'utf-8')).trim();
    if (uuid) {
      return { uuid, offset: 0 };
    }
  } catch {
    // Legacy file doesn't exist, that's fine
  }

  return { uuid: null, offset: 0 };
}

/**
 * Save tracker data for a session
 * @param {string} sessionId
 * @param {string} uuid
 * @param {number} offset
 */
async function setTrackerData(sessionId, uuid, offset) {
  await ensureTrackerDir();
  const safeSessionId = sanitizeSessionId(sessionId);
  const trackerFile = path.join(TRACKER_DIR, `${safeSessionId}.json`);
  await fsPromises.writeFile(trackerFile, JSON.stringify({ uuid, offset }), {
    mode: 0o600,
  });
}

// Legacy functions for backwards compatibility
async function getLastCapturedUuid(sessionId) {
  const data = await getTrackerData(sessionId);
  return data.uuid;
}

async function setLastCapturedUuid(sessionId, uuid) {
  // Get current offset to preserve it
  const current = await getTrackerData(sessionId);
  await setTrackerData(sessionId, uuid, current.offset);
}

/**
 * Parse transcript with incremental reading support
 * @param {string} transcriptPath
 * @param {number} startOffset - byte offset to start reading from
 * @returns {Promise<{entries: Array, endOffset: number}>}
 */
async function parseTranscriptIncremental(transcriptPath, startOffset = 0) {
  const entries = [];

  try {
    const stats = await fsPromises.stat(transcriptPath);
    const fileSize = stats.size;

    // If file is smaller than offset, file was truncated - read from beginning
    const effectiveOffset = startOffset > fileSize ? 0 : startOffset;

    // Open file for reading
    const handle = await fsPromises.open(transcriptPath, 'r');
    try {
      // Read from offset to end
      const buffer = Buffer.alloc(fileSize - effectiveOffset);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        effectiveOffset,
      );

      if (bytesRead > 0) {
        const content = buffer.slice(0, bytesRead).toString('utf-8');
        const lines = content.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            entries.push(JSON.parse(line));
          } catch (err) {
            // Log parsing errors for debugging but continue processing
            if (process.env.SUPERMEMORY_DEBUG === 'true') {
              console.error(`Failed to parse transcript line: ${err.message}`);
            }
          }
        }
      }

      return { entries, endOffset: fileSize };
    } finally {
      await handle.close();
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      if (process.env.SUPERMEMORY_DEBUG === 'true') {
        console.error(`Failed to read transcript: ${err.message}`);
      }
    }
    return { entries: [], endOffset: 0 };
  }
}

// Legacy sync function for backwards compatibility
function parseTranscript(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) {
    return [];
  }

  const content = fs.readFileSync(transcriptPath, 'utf-8');
  const lines = content.trim().split('\n');
  const entries = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch (err) {
      // Log parsing errors for debugging but continue processing
      if (process.env.SUPERMEMORY_DEBUG === 'true') {
        console.error(`Failed to parse transcript line: ${err.message}`);
      }
    }
  }

  return entries;
}

function getEntriesSinceLastCapture(entries, lastCapturedUuid) {
  if (!lastCapturedUuid) {
    return entries.filter((e) => e.type === 'user' || e.type === 'assistant');
  }

  let foundLast = false;
  const newEntries = [];

  for (const entry of entries) {
    if (entry.uuid === lastCapturedUuid) {
      foundLast = true;
      continue;
    }
    if (foundLast && (entry.type === 'user' || entry.type === 'assistant')) {
      newEntries.push(entry);
    }
  }

  return newEntries;
}

function formatEntry(entry) {
  const parts = [];

  if (entry.type === 'user') {
    const formatted = formatUserMessage(entry.message);
    if (formatted) parts.push(formatted);
  } else if (entry.type === 'assistant') {
    const formatted = formatAssistantMessage(entry.message);
    if (formatted) parts.push(formatted);
  }

  return parts.join('\n');
}

function formatUserMessage(message) {
  if (!message?.content) return null;

  const content = message.content;
  const parts = [];

  if (typeof content === 'string') {
    const cleaned = cleanContent(content);
    if (cleaned) {
      parts.push(`[role:user]\n${cleaned}\n[user:end]`);
    }
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        const cleaned = cleanContent(block.text);
        if (cleaned) {
          parts.push(`[role:user]\n${cleaned}\n[user:end]`);
        }
      } else if (block.type === 'tool_result') {
        const toolId = block.tool_use_id || '';
        const toolName = toolUseMap.get(toolId) || 'Unknown';
        if (SKIP_RESULT_TOOLS.includes(toolName)) {
          continue;
        }
        const resultContent = truncate(
          cleanContent(block.content || ''),
          MAX_TOOL_RESULT_LENGTH,
        );
        const status = block.is_error ? 'error' : 'success';
        if (resultContent) {
          parts.push(
            `[tool_result:${toolName} status="${status}"]\n${resultContent}\n[tool_result:end]`,
          );
        }
      }
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function formatAssistantMessage(message) {
  if (!message?.content) return null;

  const content = message.content;
  const parts = [];

  if (!Array.isArray(content)) return null;

  for (const block of content) {
    if (block.type === 'thinking') continue;

    if (block.type === 'text' && block.text) {
      const cleaned = cleanContent(block.text);
      if (cleaned) {
        parts.push(`[role:assistant]\n${cleaned}\n[assistant:end]`);
      }
    } else if (block.type === 'tool_use') {
      const toolName = block.name || 'Unknown';
      const toolId = block.id || '';
      const input = block.input || {};
      const inputLines = formatToolInput(input);
      parts.push(`[tool:${toolName}]\n${inputLines}\n[tool:end]`);
      if (toolId) {
        toolUseMap.set(toolId, toolName);
      }
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function formatToolInput(input) {
  const lines = [];
  for (const [key, value] of Object.entries(input)) {
    let valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    valueStr = truncate(valueStr, 200);
    lines.push(`${key}: ${valueStr}`);
  }
  return lines.join('\n');
}

function cleanContent(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<supermemory-context>[\s\S]*?<\/supermemory-context>/g, '')
    .trim();
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/**
 * Format new entries from transcript (async version with incremental parsing)
 * @param {string} transcriptPath
 * @param {string} sessionId
 * @returns {Promise<string|null>}
 */
async function formatNewEntriesAsync(transcriptPath, sessionId) {
  toolUseMap = new Map();

  try {
    // Get tracker data with offset
    const tracker = await getTrackerData(sessionId);

    // Parse transcript incrementally from last offset
    const { entries, endOffset } = await parseTranscriptIncremental(
      transcriptPath,
      tracker.offset,
    );

    if (entries.length === 0) return null;

    // Filter to new entries since last UUID
    const newEntries = getEntriesSinceLastCapture(entries, tracker.uuid);

    if (newEntries.length === 0) {
      // Update offset even if no new entries (file grew but no relevant content)
      await setTrackerData(sessionId, tracker.uuid, endOffset);
      return null;
    }

    const firstEntry = newEntries[0];
    const lastEntry = newEntries[newEntries.length - 1];
    const timestamp = firstEntry.timestamp || new Date().toISOString();

    const formattedParts = [];

    formattedParts.push(`[turn:start timestamp="${timestamp}"]`);

    for (const entry of newEntries) {
      const formatted = formatEntry(entry);
      if (formatted) {
        formattedParts.push(formatted);
      }
    }

    formattedParts.push('[turn:end]');

    const result = formattedParts.join('\n\n');

    if (result.length < 100) return null;

    // Save both UUID and offset
    await setTrackerData(sessionId, lastEntry.uuid, endOffset);

    return result;
  } finally {
    // Always clear toolUseMap to prevent memory leaks
    toolUseMap = new Map();
  }
}

// Legacy sync function for backwards compatibility
function formatNewEntries(transcriptPath, sessionId) {
  toolUseMap = new Map();

  try {
    const entries = parseTranscript(transcriptPath);
    if (entries.length === 0) return null;

    // Use sync version for backwards compat
    const safeSessionId = sanitizeSessionId(sessionId);
    const trackerFile = path.join(TRACKER_DIR, `${safeSessionId}.txt`);
    let lastCapturedUuid = null;
    try {
      if (fs.existsSync(trackerFile)) {
        lastCapturedUuid = fs.readFileSync(trackerFile, 'utf-8').trim();
      }
    } catch {
      // Ignore
    }

    const newEntries = getEntriesSinceLastCapture(entries, lastCapturedUuid);

    if (newEntries.length === 0) return null;

    const firstEntry = newEntries[0];
    const lastEntry = newEntries[newEntries.length - 1];
    const timestamp = firstEntry.timestamp || new Date().toISOString();

    const formattedParts = [];

    formattedParts.push(`[turn:start timestamp="${timestamp}"]`);

    for (const entry of newEntries) {
      const formatted = formatEntry(entry);
      if (formatted) {
        formattedParts.push(formatted);
      }
    }

    formattedParts.push('[turn:end]');

    const result = formattedParts.join('\n\n');

    if (result.length < 100) return null;

    // Save UUID (sync version)
    try {
      if (!fs.existsSync(TRACKER_DIR)) {
        fs.mkdirSync(TRACKER_DIR, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(trackerFile, lastEntry.uuid, { mode: 0o600 });
    } catch {
      // Ignore
    }

    return result;
  } finally {
    // Always clear toolUseMap to prevent memory leaks
    toolUseMap = new Map();
  }
}

module.exports = {
  parseTranscript,
  parseTranscriptIncremental,
  getEntriesSinceLastCapture,
  formatEntry,
  formatNewEntries,
  formatNewEntriesAsync,
  cleanContent,
  truncate,
  getLastCapturedUuid,
  setLastCapturedUuid,
  getTrackerData,
  setTrackerData,
  sanitizeSessionId,
};
