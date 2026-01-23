function getRelativePath(filePath) {
  if (!filePath) return 'unknown';
  const parts = filePath.split('/');
  return parts.slice(-2).join('/');
}

function truncate(str, maxLen = 50) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

function compressObservation(toolName, toolInput, toolResponse) {
  const input = toolInput || {};
  const response = toolResponse || {};

  switch (toolName) {
    case 'Edit': {
      const file = getRelativePath(input.file_path);
      const oldSnippet = truncate(input.old_string, 30);
      const newSnippet = truncate(input.new_string, 30);
      if (input.replace_all) return `Replaced all "${oldSnippet}" with "${newSnippet}" in ${file}`;
      return `Edited ${file}: "${oldSnippet}" → "${newSnippet}"`;
    }
    case 'Write': {
      const file = getRelativePath(input.file_path);
      const contentLen = (input.content || '').length;
      return `Created ${file} (${contentLen} chars)`;
    }
    case 'Bash': {
      const cmd = truncate(input.command, 80);
      const success = !response.error && response.exitCode !== 1;
      const desc = input.description ? ` - ${truncate(input.description, 40)}` : '';
      return `Ran: ${cmd}${desc}${success ? '' : ' [FAILED]'}`;
    }
    case 'Task': {
      const desc = input.description || truncate(input.prompt, 60) || 'subtask';
      const agent = input.subagent_type || 'agent';
      return `Spawned ${agent}: ${desc}`;
    }
    case 'Read': {
      const file = getRelativePath(input.file_path);
      const lines = input.limit ? ` (${input.limit} lines)` : '';
      return `Read ${file}${lines}`;
    }
    case 'Glob': {
      const pattern = input.pattern || '*';
      const path = input.path ? ` in ${getRelativePath(input.path)}` : '';
      return `Glob: ${pattern}${path}`;
    }
    case 'Grep': {
      const pattern = truncate(input.pattern, 40);
      const path = input.path ? ` in ${getRelativePath(input.path)}` : '';
      return `Grep: "${pattern}"${path}`;
    }
    case 'WebFetch': {
      const url = truncate(input.url, 60);
      return `Fetched: ${url}`;
    }
    case 'WebSearch': {
      const query = truncate(input.query, 60);
      return `Searched web: "${query}"`;
    }
    case 'NotebookEdit': {
      const notebook = getRelativePath(input.notebook_path);
      const mode = input.edit_mode || 'edit';
      return `${mode} notebook cell in ${notebook}`;
    }
    default:
      return `Used ${toolName}`;
  }
}

function getObservationMetadata(toolName, toolInput) {
  const input = toolInput || {};
  const metadata = { tool: toolName };
  if (input.file_path) metadata.file = getRelativePath(input.file_path);
  if (input.notebook_path) metadata.file = getRelativePath(input.notebook_path);
  if (toolName === 'Bash' && input.command) metadata.command = truncate(input.command, 100);
  if (input.pattern) metadata.pattern = truncate(input.pattern, 50);
  return metadata;
}

module.exports = { compressObservation, getObservationMetadata, getRelativePath, truncate };
