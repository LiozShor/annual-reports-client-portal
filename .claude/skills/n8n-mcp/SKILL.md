# n8n MCP Gotchas

Critical patterns that MUST be followed when using n8n-MCP tools. Violations cause silent failures.

## updateNode format
```javascript
// CORRECT:
{type: "updateNode", nodeName: "X", updates: {"parameters.jsCode": "...code..."}}
// WRONG: missing `updates` wrapper or missing `parameters.` prefix
```

## Execute Workflow workflowId (typeVersion >= 1.1)
```javascript
updates: {"parameters.workflowId": {"__rl": true, "value": "workflow_id", "mode": "id"}}
// WRONG: plain string value — causes "No information about the workflow to execute found"
```

## Always include `intent`
```javascript
n8n_update_partial_workflow({id: "...", intent: "description", operations: [...]})
```

## Connection Rules
- IF node: `"branch": "true"` or `"branch": "false"`
- addConnection: `source`, `target`, `sourcePort: "main"`, `targetPort: "main"`

## Validation Ladder
validate_node(minimal) → validate_node(full, runtime) → validate_workflow

## Rollback Protocol (Production)
1. Note workflow ID + current state before modifying
2. If validation fails: do NOT declare complete, attempt revert, if impossible deactivate + notify user
3. Never leave a production workflow in a broken active state
