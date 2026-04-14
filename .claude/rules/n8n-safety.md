# n8n Workflow Safety Rules

## Before Modifying ANY Workflow
1. List ALL matching workflows and check recent execution counts to identify the actively-running version
2. Show the workflow list to the user before proceeding with changes
3. Check for duplicate/renamed workflows — the active version may not be the one found first

## n8n Skills First
Load the relevant n8n skill BEFORE making n8n MCP calls or writing n8n code.

## After Modifying ANY Workflow
Run `/silent-failure-hunt` on the modified workflow before deploying. Also run after editing Workers route handlers in `api/src/routes/`.
