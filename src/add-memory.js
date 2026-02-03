const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag, getProjectName, validateCwd } = require('./lib/container-tag');
const { loadSettings, getApiKey } = require('./lib/settings');
const { sanitizeContent, auditLog, MAX_CONTENT_LENGTH } = require('./lib/security');

async function main() {
  const rawContent = process.argv.slice(2).join(' ');

  if (!rawContent || !rawContent.trim()) {
    console.log(
      'No content provided. Usage: node add-memory.cjs "content to save"',
    );
    return;
  }

  // Sanitize and validate content
  const sanitized = sanitizeContent(rawContent);
  if (sanitized.redacted) {
    console.log('Warning: Some sensitive data was redacted from your content.');
    auditLog('manual_add_redacted', { originalLength: rawContent.length });
  }
  if (sanitized.truncated) {
    console.log(`Warning: Content was truncated to ${MAX_CONTENT_LENGTH} characters.`);
  }

  const content = sanitized.content;
  if (!content.trim()) {
    console.log('Content is empty after sanitization.');
    return;
  }

  const settings = loadSettings();

  let apiKey;
  try {
    apiKey = getApiKey(settings);
  } catch {
    console.log('Supermemory API key not configured.');
    console.log('Set SUPERMEMORY_CC_API_KEY environment variable.');
    return;
  }

  const cwd = process.cwd();

  // Validate cwd
  if (!validateCwd(cwd)) {
    console.log('Error: Invalid working directory.');
    return;
  }

  const containerTag = getContainerTag(cwd);
  const projectName = getProjectName(cwd);

  try {
    const client = new SupermemoryClient(apiKey, containerTag);
    const result = await client.addMemory(content, containerTag, {
      type: 'manual',
      project: projectName,
      timestamp: new Date().toISOString(),
    });

    console.log(`Memory saved to project: ${projectName}`);
    console.log(`ID: ${result.id}`);
  } catch (err) {
    console.log(`Error saving memory: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
