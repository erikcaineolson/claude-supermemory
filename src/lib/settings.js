const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadCredentials } = require('./auth');

const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

// Whitelist of valid tool names for validation
const VALID_TOOL_NAMES = [
  'Read',
  'Glob',
  'Grep',
  'Edit',
  'Write',
  'Bash',
  'Task',
  'TodoWrite',
  'AskUserQuestion',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
  'LS',
];

const DEFAULT_SETTINGS = {
  skipTools: ['Read', 'Glob', 'Grep', 'TodoWrite', 'AskUserQuestion'],
  captureTools: ['Edit', 'Write', 'Bash', 'Task'],
  maxProfileItems: 5,
  debug: false,
  injectProfile: true,
};

function ensureSettingsDir() {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
    }
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

/**
 * Validate tool names against whitelist.
 * Returns only valid tool names from the input.
 */
function validateToolNames(toolNames) {
  if (!Array.isArray(toolNames)) return [];
  return toolNames.filter(
    (name) => typeof name === 'string' && VALID_TOOL_NAMES.includes(name),
  );
}

function loadSettings() {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const fileContent = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      Object.assign(settings, JSON.parse(fileContent));
    }
  } catch (err) {
    console.error(`Settings: Failed to load ${SETTINGS_FILE}: ${err.message}`);
  }
  if (process.env.SUPERMEMORY_CC_API_KEY)
    settings.apiKey = process.env.SUPERMEMORY_CC_API_KEY;
  if (process.env.SUPERMEMORY_SKIP_TOOLS) {
    const requestedTools = process.env.SUPERMEMORY_SKIP_TOOLS.split(',').map(
      (s) => s.trim(),
    );
    const validTools = validateToolNames(requestedTools);
    if (validTools.length > 0) {
      settings.skipTools = validTools;
    }
    // Log warning for invalid tool names
    const invalidTools = requestedTools.filter(
      (t) => !VALID_TOOL_NAMES.includes(t),
    );
    if (invalidTools.length > 0 && settings.debug) {
      console.error(
        `Warning: Invalid tool names in SUPERMEMORY_SKIP_TOOLS: ${invalidTools.join(', ')}`,
      );
    }
  }
  if (process.env.SUPERMEMORY_DEBUG === 'true') settings.debug = true;
  return settings;
}

function saveSettings(settings) {
  ensureSettingsDir();
  const toSave = { ...settings };
  delete toSave.apiKey;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2), {
    mode: 0o600,
  });
}

function getApiKey(settings) {
  if (settings.apiKey) return settings.apiKey;
  if (process.env.SUPERMEMORY_CC_API_KEY)
    return process.env.SUPERMEMORY_CC_API_KEY;

  const credentials = loadCredentials();
  if (credentials?.apiKey) return credentials.apiKey;

  throw new Error('NO_API_KEY');
}

function shouldCaptureTool(toolName, settings) {
  if (settings.skipTools.includes(toolName)) return false;
  if (settings.captureTools && settings.captureTools.length > 0) {
    return settings.captureTools.includes(toolName);
  }
  return true;
}

function debugLog(settings, message, data) {
  if (settings.debug) {
    const timestamp = new Date().toISOString();
    console.error(
      data
        ? `[${timestamp}] ${message}: ${JSON.stringify(data)}`
        : `[${timestamp}] ${message}`,
    );
  }
}

module.exports = {
  SETTINGS_DIR,
  SETTINGS_FILE,
  DEFAULT_SETTINGS,
  VALID_TOOL_NAMES,
  loadSettings,
  saveSettings,
  getApiKey,
  shouldCaptureTool,
  debugLog,
  validateToolNames,
};
