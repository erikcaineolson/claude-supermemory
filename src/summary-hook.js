const { createClient, isLocalBackend } = require('./lib/client-factory');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { loadSettings, getApiKey, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { formatNewEntries } = require('./lib/transcript-formatter');
const { validateTranscriptPath, auditLog } = require('./lib/security');

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id;
    const transcriptPath = input.transcript_path;

    debugLog(settings, 'Stop', { sessionId, transcriptPath });

    if (!transcriptPath || !sessionId) {
      debugLog(settings, 'Missing transcript path or session id');
      writeOutput({ continue: true });
      return;
    }

    // Validate transcript path is in expected location
    const pathValidation = validateTranscriptPath(transcriptPath);
    if (!pathValidation.valid) {
      auditLog('transcript_path_rejected', {
        path: transcriptPath,
        reason: pathValidation.reason,
      });
      debugLog(settings, `Invalid transcript path: ${pathValidation.reason}`);
      writeOutput({ continue: true });
      return;
    }

    // For cloud backend, verify API key exists
    if (!isLocalBackend()) {
      try {
        getApiKey(settings);
      } catch {
        writeOutput({ continue: true });
        return;
      }
    }

    const formatted = formatNewEntries(transcriptPath, sessionId);

    if (!formatted) {
      debugLog(settings, 'No new content to save');
      writeOutput({ continue: true });
      return;
    }

    const containerTag = getContainerTag(cwd);
    const projectName = getProjectName(cwd);
    const client = createClient(containerTag);

    await client.addMemory(
      formatted,
      containerTag,
      {
        type: 'session_turn',
        project: projectName,
        timestamp: new Date().toISOString(),
      },
      sessionId,
    );

    debugLog(settings, 'Session turn saved', { length: formatted.length });
    writeOutput({ continue: true });
  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    console.error(`Supermemory: ${err.message}`);
    writeOutput({ continue: true });
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
