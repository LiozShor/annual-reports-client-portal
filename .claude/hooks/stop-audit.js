#!/usr/bin/env node
// Hook E: Stop Audit (Stop)
// ALWAYS enabled — no profile gating.
// Final safety check on modified files. Informational only — never blocks.
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let data = '';
process.stdin.on('data', c => (data += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

    // Get all modified files (staged + unstaged)
    let files = '';
    try {
      files = execSync('git diff --name-only && git diff --staged --name-only', {
        cwd,
        encoding: 'utf8',
        timeout: 5000,
      });
    } catch (e) {
      process.exit(0);
    }

    const modifiedFiles = [...new Set(files.trim().split('\n').filter(Boolean))];
    if (modifiedFiles.length === 0) process.exit(0);

    const issues = [];

    // Check for sensitive files
    const sensitivePatterns = ['.env', '.pem', 'credentials', 'secret', '.key'];
    for (const f of modifiedFiles) {
      const lower = f.toLowerCase();
      if (sensitivePatterns.some(p => lower.includes(p))) {
        issues.push(`  \u26A0\uFE0F Sensitive file modified: ${f}`);
      }
    }

    // Check frontend files for banned patterns
    const frontendFiles = modifiedFiles.filter(
      f => f.includes('frontend/') && /\.(js|html)$/.test(f)
    );

    for (const f of frontendFiles) {
      try {
        const content = fs.readFileSync(path.join(cwd, f), 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
          if (/\b(confirm|alert)\s*\(/.test(trimmed) || /\bconsole\.log\s*\(/.test(trimmed)) {
            issues.push(`  \u26A0\uFE0F Banned pattern in ${f}:${i + 1}`);
          }
        }
      } catch (e) {
        /* file might not exist on disk */
      }
    }

    if (issues.length > 0) {
      process.stderr.write('[STOP AUDIT] Issues found in modified files:\n');
      issues.forEach(i => process.stderr.write(i + '\n'));
      process.stderr.write('\n');
    }

    process.stderr.write(
      '[STOP AUDIT] Remember: update .agent/current-status.md if this session made meaningful changes.\n'
    );
  } catch (e) {
    // Never block on stop
  }
  process.exit(0);
});
