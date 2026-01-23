const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { stripPrivateFromJson } = require('./lib/privacy');
const { compressObservation, getObservationMetadata } = require('./lib/compress');
const { loadSettings, getApiKey, shouldCaptureTool, debugLog } = require('./lib/settings');
const { readStdin, outputSuccess, outputError } = require('./lib/stdin');

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id;
    const toolName = input.tool_name;
    const toolInput = input.tool_input;
    const toolResponse = input.tool_response;

    debugLog(settings, 'PostToolUse', { sessionId, toolName });

    if (!shouldCaptureTool(toolName, settings)) {
      debugLog(settings, 'Skipping tool', { toolName });
      outputSuccess();
      return;
    }

    let apiKey;
    try {
      apiKey = getApiKey(settings);
    } catch {
      outputSuccess();
      return;
    }

    const cleanInput = stripPrivateFromJson(toolInput);
    const cleanResponse = stripPrivateFromJson(toolResponse);
    const compressed = compressObservation(toolName, cleanInput, cleanResponse);

    if (!compressed) {
      debugLog(settings, 'No compression result');
      outputSuccess();
      return;
    }

    const client = new SupermemoryClient(apiKey);
    const containerTag = getContainerTag(cwd);
    const projectName = getProjectName(cwd);

    const metadata = {
      ...getObservationMetadata(toolName, cleanInput),
      type: 'observation',
      project: projectName,
      timestamp: new Date().toISOString()
    };

    await client.addMemory(`[${toolName.toUpperCase()}] ${compressed}`, containerTag, metadata, sessionId);

    debugLog(settings, 'Observation saved', { compressed });
    outputSuccess();

  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    outputError(err.message);
  }
}

main().catch(err => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
