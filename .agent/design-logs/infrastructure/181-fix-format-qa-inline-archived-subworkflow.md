---
id: DL-181
title: Fix Format Q&A — Inline Archived Sub-Workflow
date: 2026-03-25
status: done
---

## Problem

`[02] Questionnaire Response Processing` (QqEIWQlRs1oZzEtNxFUcQ) had a `Format Q&A` node (`format-qa-node`) that called `[ARCHIVED] Format Questionnaire` (9zqfOuniztQc2hEl) via `n8n-nodes-base.executeWorkflow`.

The sub-workflow was archived during the DL-170 Cloudflare Workers migration and is inactive. Any questionnaire submission was failing with:

> "Workflow is not active and cannot be executed."

Clients were actively submitting — fix was urgent.

## Fix

Replaced the `executeWorkflow` node with an inline `n8n-nodes-base.code` node containing the 122-line format logic.

**Node changed:** `format-qa-node`
- Before: `type: n8n-nodes-base.executeWorkflow`, calling workflow `9zqfOuniztQc2hEl`
- After: `type: n8n-nodes-base.code`, `typeVersion: 2`, logic inlined

**Connections unchanged:** Fetch Record → Format Q&A → Get Mappings

## Implementation

Used REST API PUT (full workflow replacement) because `n8n_update_partial_workflow` only supports `parameters` updates — cannot change node `type`.

Settings in PUT: `{ executionOrder: "v1", callerPolicy: "workflowsFromSameOwner" }` — excluded `availableInMCP` and `timeSavedMode` to avoid 400 errors.

## Inlined Logic (from archived sub-workflow)

- Reads `$input.all()` (runOnceForAllItems mode — matches Code node typeVersion 2 default)
- Outputs: `{ client_info, answers[], raw_answers }`
- Filters hidden/system fields, formats boolean answers to ✓/✗, normalizes phone numbers
- Reorders insurance company fields to appear after withdrawal anchor field

## Result

HTTP 200 — workflow updated successfully. `format-qa-node` is now `n8n-nodes-base.code` typeVersion 2.
