const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag, getProjectName, validateCwd } = require('./lib/container-tag');
const { loadSettings, getApiKey, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { startAuthFlow } = require('./lib/auth');
const { formatContext } = require('./lib/format-context');
const { auditLog } = require('./lib/security');

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const rawCwd = input.cwd || process.cwd();

    // Validate cwd before using it
    if (!validateCwd(rawCwd)) {
      auditLog('cwd_validation_failed', { cwd: rawCwd });
      writeOutput({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `<supermemory-status>
Invalid working directory. Session will continue without memory context.
</supermemory-status>`,
        },
      });
      return;
    }

    const cwd = rawCwd;
    const containerTag = getContainerTag(cwd);
    const projectName = getProjectName(cwd);

    debugLog(settings, 'SessionStart', { cwd, containerTag, projectName });

    let apiKey;
    try {
      apiKey = getApiKey(settings);
    } catch {
      try {
        debugLog(settings, 'No API key found, starting browser auth flow');
        apiKey = await startAuthFlow();
        debugLog(settings, 'Auth flow completed successfully');
      } catch (authErr) {
        const isTimeout = authErr.message === 'AUTH_TIMEOUT';
        writeOutput({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `<supermemory-status>
${isTimeout ? 'Authentication timed out. Please complete login in the browser window.' : 'Authentication failed.'}
If the browser did not open, visit: https://console.supermemory.ai/auth/connect
Or set SUPERMEMORY_CC_API_KEY environment variable manually.
</supermemory-status>`,
          },
        });
        return;
      }
    }

    const client = new SupermemoryClient(apiKey);
    const profileResult = await client
      .getProfile(containerTag, projectName)
      .catch(() => null);

    const additionalContext = formatContext(
      profileResult,
      true,
      false,
      settings.maxProfileItems,
    );

    if (!additionalContext) {
      writeOutput({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `<supermemory-context>
No previous memories found for this project.
Memories will be saved as you work.
</supermemory-context>`,
        },
      });
      return;
    }

    debugLog(settings, 'Context generated', {
      length: additionalContext.length,
    });

    writeOutput({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
    });
  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    console.error(`Supermemory: ${err.message}`);
    writeOutput({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `<supermemory-status>
Failed to load memories: ${err.message}
Session will continue without memory context.
</supermemory-status>`,
      },
    });
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
