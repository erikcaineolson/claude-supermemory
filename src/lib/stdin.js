const {
  validateStdinSize,
  validateStdinInput,
  auditLog,
  MAX_STDIN_SIZE,
} = require('./security');

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    let totalSize = 0;
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk) => {
      totalSize += chunk.length;

      // Prevent DoS via oversized input
      if (totalSize > MAX_STDIN_SIZE) {
        auditLog('stdin_size_exceeded', { size: totalSize });
        reject(new Error('Input exceeds maximum allowed size'));
        return;
      }

      data += chunk;
    });

    process.stdin.on('end', () => {
      try {
        // Validate size
        const sizeCheck = validateStdinSize(data);
        if (!sizeCheck.valid) {
          auditLog('stdin_validation_failed', { reason: sizeCheck.reason });
          reject(new Error(sizeCheck.reason));
          return;
        }

        // Parse JSON
        const parsed = data.trim() ? JSON.parse(data) : {};

        // Validate and sanitize input
        const inputCheck = validateStdinInput(parsed);
        if (!inputCheck.valid) {
          auditLog('stdin_input_invalid', { reason: inputCheck.reason });
          reject(new Error(`Invalid input: ${inputCheck.reason}`));
          return;
        }

        // Return sanitized input merged with original (sanitized fields take precedence)
        resolve({ ...parsed, ...inputCheck.sanitized });
      } catch (err) {
        auditLog('stdin_parse_error', { error: err.message });
        reject(new Error(`Failed to parse stdin JSON: ${err.message}`));
      }
    });

    process.stdin.on('error', (err) => {
      auditLog('stdin_error', { error: err.message });
      reject(err);
    });

    if (process.stdin.isTTY) resolve({});
  });
}

function writeOutput(data) {
  console.log(JSON.stringify(data));
}

function outputSuccess(additionalContext = null) {
  if (additionalContext) {
    writeOutput({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
    });
  } else {
    writeOutput({ continue: true, suppressOutput: true });
  }
}

function outputError(message) {
  console.error(`Supermemory: ${message}`);
  writeOutput({ continue: true, suppressOutput: true });
}

module.exports = { readStdin, writeOutput, outputSuccess, outputError };
