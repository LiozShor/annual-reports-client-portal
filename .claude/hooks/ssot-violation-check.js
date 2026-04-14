#!/usr/bin/env node
// Hook B: SSOT Violation Check (PreToolUse — Edit|Write)
// Profile: standard + strict only.
// Warns (does not block) when hardcoded Hebrew doc titles appear in generator files.
'use strict';

const profile = process.env.CLAUDE_HOOK_PROFILE || 'standard';
const PROFILES = { minimal: 0, standard: 1, strict: 2 };
if ((PROFILES[profile] || 0) < PROFILES['standard']) process.exit(0);

let data = '';
process.stdin.on('data', c => (data += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = (input.tool_input.file_path || '').replace(/\\/g, '/');
    const basename = filePath.split('/').pop() || '';

    // Only check SSOT-related files
    const isTarget =
      basename === 'ssot-document-generator.js' ||
      basename.startsWith('document-service') ||
      basename.startsWith('document-types');
    if (!isTarget) process.exit(0);

    const content = input.tool_input.content || input.tool_input.new_string || '';
    if (!content) process.exit(0);

    // Known document title patterns that should come from SSOT templates, not hardcoded
    const hardcodedPatterns = [
      /["'`]\u05D8\u05D5\u05E4\u05E1 106/,  // טופס 106
      /["'`]\u05D0\u05D9\u05E9\u05D5\u05E8 \u05E9\u05E0\u05EA\u05D9/, // אישור שנתי
      /["'`]\u05D8\u05D5\u05E4\u05E1 867/,  // טופס 867
      /["'`]\u05E1\u05E4\u05D7 \u05EA/,     // ספח ת (appendix)
      /["'`]\u05D0\u05D9\u05E9\u05D5\u05E8 \u05E0\u05D9\u05DB\u05D5\u05D9/, // אישור ניכוי
      /["'`]\u05D0\u05D9\u05E9\u05D5\u05E8 \u05D3\u05DE\u05D9/, // אישור דמי
    ];

    const lines = content.split('\n');
    const issues = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments and template variable assignments
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      // Skip lines that reference SSOT template functions
      if (/getTemplate|SSOT|templateId|docTemplate/.test(line)) continue;

      for (const pat of hardcodedPatterns) {
        if (pat.test(line)) {
          issues.push(`  Line ${i + 1}: ${trimmed.substring(0, 80)}`);
          break;
        }
      }
    }

    if (issues.length > 0) {
      // Warn via JSON additionalContext (visible to Claude) — don't block
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          additionalContext:
            `[SSOT WARNING] Potential hardcoded document titles in ${basename}:\n` +
            issues.join('\n') +
            '\n\nDocument titles MUST come from SSOT templates. ' +
            'See SSOT_required_documents_from_Tally_input.md.',
        },
      };
      process.stdout.write(JSON.stringify(output));
    }
  } catch (e) {
    // Never block on hook errors
  }
  process.exit(0);
});
