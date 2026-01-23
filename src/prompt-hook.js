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

    if (!prompt || !prompt.trim()) {
      outputSuccess();
      return;
    }

    const cleanPrompt = stripPrivateContent(prompt);

    if (isFullyPrivate(prompt)) {
      debugLog(settings, 'Skipping fully private prompt');
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

    const client = new SupermemoryClient(apiKey);
    const containerTag = getContainerTag(cwd);
    const projectName = getProjectName(cwd);

    await client.addMemory(
      `[USER] ${cleanPrompt}`,
      containerTag,
      { type: 'user_prompt', project: projectName, timestamp: new Date().toISOString() },
      sessionId
    );

    debugLog(settings, 'Prompt saved');
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
