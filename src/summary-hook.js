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

    let apiKey;
    try {
      apiKey = getApiKey(settings);
    } catch {
      writeOutput({ continue: true });
      return;
    }

    const client = new SupermemoryClient(apiKey);
    const containerTag = getContainerTag(cwd);
    const projectName = getProjectName(cwd);

    await client.addMemory(
      `[SESSION_END] Session completed in ${projectName}`,
      containerTag,
      { type: 'session_end', project: projectName, timestamp: new Date().toISOString() },
      sessionId
    );

    debugLog(settings, 'Session end saved');
    writeOutput({ continue: true });

  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    console.error(`Supermemory: ${err.message}`);
    writeOutput({ continue: true });
  }
}

main().catch(err => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
