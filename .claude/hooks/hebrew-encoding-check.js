#!/usr/bin/env node
// Hook A: Hebrew Encoding Corruption Check (PreToolUse — Edit|Write)
// ALWAYS enabled — no profile gating.
// Blocks edits that introduce garbled Hebrew (UTF-8 decoded as Latin-1).
'use strict';

let data = '';
process.stdin.on('data', c => (data += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = (input.tool_input.file_path || '').replace(/\\/g, '/');

    // Only check files in client portal with relevant extensions
    if (!filePath.includes('github/annual-reports-client-portal/')) process.exit(0);
    if (!/\.(js|html|md)$/.test(filePath)) process.exit(0);

    // Get the content being written/edited
    const content = input.tool_input.content || input.tool_input.new_string || '';
    if (!content) process.exit(0);

    const lines = content.split('\n');
    const issues = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // UTF-8 Hebrew (U+05xx) misread as Latin-1 produces × (0xD7) followed by 0x80-0xBF
      // Also check for replacement character and the "ï¿½" sequence
      if (
        /\u00D7[\u0080-\u00BF]/.test(line) ||
        /ï¿½/.test(line) ||
        /\uFFFD/.test(line)
      ) {
        issues.push(`  Line ${i + 1}: ${line.substring(0, 100)}`);
      }
    }

    if (issues.length > 0) {
      process.stderr.write(
        `[HOOK] Hebrew encoding corruption detected in ${filePath}:\n` +
          issues.join('\n') +
          '\n\nThis means Hebrew text was decoded as Latin-1 instead of UTF-8.\n' +
          'Fix: use proper UTF-8 Hebrew characters (U+0590\u2013U+05FF).\n'
      );
      process.exit(2);
    }
  } catch (e) {
    // Never block on hook errors
  }
  process.exit(0);
});
