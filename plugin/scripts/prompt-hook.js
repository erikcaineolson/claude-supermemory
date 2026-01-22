#!/usr/bin/env node
/**
 * UserPromptSubmit Hook - Save User Prompt
 *
 * Saves the user's prompt to Supermemory for context.
 *
 * Input (stdin):
 *   { session_id, prompt, cwd, hook_event_name }
 *
 * Output (stdout):
 *   { continue: true, suppressOutput: true }
 */

const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { stripPrivateContent, isFullyPrivate } = require('./lib/privacy');
const { loadSettings, getApiKey, debugLog } = require('./lib/settings');
const { readStdin, outputSuccess, outputError } = require('./lib/stdin');

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id;
    const prompt = input.prompt;

    debugLog(settings, 'UserPromptSubmit', { sessionId, promptLength: prompt?.length });

    // Skip if no prompt
    if (!prompt || !prompt.trim()) {
      outputSuccess();
      return;
    }

    // Strip privacy tags
    const cleanPrompt = stripPrivateContent(prompt);

    // Skip if fully private
    if (isFullyPrivate(prompt)) {
      debugLog(settings, 'Skipping fully private prompt');
      outputSuccess();
      return;
    }

    // Get API key
    let apiKey;
    try {
      apiKey = getApiKey(settings);
    } catch {
      // No API key - silently continue
      outputSuccess();
      return;
    }

    const client = new SupermemoryClient(apiKey);
    const containerTag = getContainerTag(cwd);
    const projectName = getProjectName(cwd);

    // Save prompt to Supermemory
    await client.addMemory(
      `[USER] ${cleanPrompt}`,
      containerTag,
      {
        type: 'user_prompt',
        project: projectName,
        timestamp: new Date().toISOString()
      },
      sessionId  // customId - accumulates all session content into one document
    );

    debugLog(settings, 'Prompt saved');
    outputSuccess();

  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    // Non-blocking - continue session
    outputError(err.message);
  }
}

main().catch(err => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
