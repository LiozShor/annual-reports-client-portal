#!/usr/bin/env node
// Hook C: Banned Frontend Patterns (PreToolUse — Edit|Write)
// Profile: standard + strict only.
// Blocks edits introducing confirm(), alert(), or console.log() in client portal code.
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

    // Only check frontend files
    if (!filePath.includes('frontend/')) process.exit(0);
    if (!/\.(js|html)$/.test(filePath)) process.exit(0);

    const content = input.tool_input.content || input.tool_input.new_string || '';
    if (!content) process.exit(0);

    const lines = content.split('\n');
    const issues = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // Skip comment lines
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      // Skip HTML comments
      if (trimmed.startsWith('<!--')) continue;

      if (/\bconfirm\s*\(/.test(trimmed)) {
        issues.push(`  Line ${i + 1}: confirm() — use showConfirmDialog() instead`);
      }
      if (/\balert\s*\(/.test(trimmed)) {
        issues.push(`  Line ${i + 1}: alert() — use showModal() instead`);
      }
      if (/\bconsole\.log\s*\(/.test(trimmed)) {
        issues.push(`  Line ${i + 1}: console.log() — remove debug logging`);
      }
    }

    if (issues.length > 0) {
      process.stderr.write(
        `[HOOK] Banned patterns in ${filePath}:\n` +
          issues.join('\n') +
          '\n\nUse the UI design system instead (docs/ui-design-system.md):\n' +
          '  confirm() → showConfirmDialog(message, onConfirm, confirmText, danger)\n' +
          '  alert()   → showModal(type, title, body, stats)\n' +
          '  console.log() → remove or use showAIToast() for user-facing messages\n'
      );
      process.exit(2);
    }
  } catch (e) {
    // Never block on hook errors
  }
  process.exit(0);
});
