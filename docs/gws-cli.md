# Google Workspace CLI (`gws`)

Installed globally via `npm install -g @googleworkspace/cli`. Authenticated as `liozshor1@gmail.com`.

**Use cases:**
- **Send emails:** Send documents or notifications directly via Gmail API
- **Check test emails:** Search inbox for test emails sent by n8n workflows to verify delivery, content, and formatting
- **Calendar/Drive:** Access calendar events and Drive files when needed

**Common commands:**
```bash
# Send an email
gws gmail users messages send --params '{"userId":"me"}' --json '{"raw":"'$(echo -e "To: recipient@email.com\nSubject: subject\nContent-Type: text/plain; charset=utf-8\n\nbody" | base64 -w 0 | tr '+/' '-_' | tr -d '=')'"}'

# Search inbox (e.g., find test emails from n8n)
gws gmail users messages list --params '{"userId":"me","q":"from:reports@moshe-atsits.co.il","maxResults":5}'

# Read a specific email
gws gmail users messages get --params '{"userId":"me","id":"MESSAGE_ID"}'
```

**Note:** Office email (`reports@moshe-atsits.co.il`) sends via n8n. `gws` uses `liozshor1@gmail.com` — useful for inspecting received test emails, not for sending as the office.
