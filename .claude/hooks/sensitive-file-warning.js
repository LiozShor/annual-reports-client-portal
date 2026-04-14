#!/usr/bin/env node
// Hook D: Sensitive File Warning (PreToolUse — Read)
// Profile: standard + strict only.
// Warns when reading sensitive files. Never blocks.
'use strict';

const profile = process.env.CLAUDE_HOOK_PROFILE || 'standard';
const PROFILES = { minimal: 0, standard: 1, strict: 2 };
if ((PROFILES[profile] || 0) < PROFILES['standard']) process.exit(0);

let data = '';
process.stdin.on('data', c => (data += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = (input.tool_input.file_path || '').replace(/\\/g, '/').toLowerCase();
    const basename = filePath.split('/').pop() || '';

    const isSensitive =
      basename === '.env' ||
      basename.startsWith('.env.') ||
      basename.endsWith('.pem') ||
      basename.endsWith('.key') ||
      basename.includes('credential') ||
      basename.includes('secret');

    if (isSensitive) {
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          additionalContext:
            '\u26A0\uFE0F Reading sensitive file: ' +
            basename +
            ' \u2014 do NOT include raw secrets/tokens in responses or commit to git.',
        },
      };
      process.stdout.write(JSON.stringify(output));
    }
  } catch (e) {
    // Never block on hook errors
  }
  process.exit(0);
});
