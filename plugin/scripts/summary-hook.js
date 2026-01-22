#!/usr/bin/env node
/**
 * Stop Hook - Session Summary
 *
 * Generates and saves a session summary to Supermemory.
 *
 * Input (stdin):
 *   { session_id, cwd, hook_event_name, transcript_path }
 *
 * Output (stdout):
 *   { continue: true }
 */

const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { loadSettings, getApiKey, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id;

    debugLog(settings, 'Stop', { sessionId });

    // Get API key
    let apiKey;
    try {
      apiKey = getApiKey(settings);
    } catch {
      // No API key - silently continue
      writeOutput({ continue: true });
      return;
    }

    const client = new SupermemoryClient(apiKey);
    const containerTag = getContainerTag(cwd);
    const projectName = getProjectName(cwd);

    // Save session end marker
    await client.addMemory(
      `[SESSION_END] Session completed in ${projectName}`,
      containerTag,
      {
        type: 'session_end',
        project: projectName,
        timestamp: new Date().toISOString()
      },
      sessionId 
    );

    debugLog(settings, 'Session end saved');
    writeOutput({ continue: true });

  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    // Non-blocking - continue
    console.error(`Supermemory: ${err.message}`);
    writeOutput({ continue: true });
  }
}

main().catch(err => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
