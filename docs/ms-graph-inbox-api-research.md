# MS Graph API — List/Search Inbox Messages (Research)

**Date:** 2026-03-26
**Purpose:** API reference for reading inbox messages with date filtering, for use in n8n workflow.

---

## 1. Endpoint

```
GET https://graph.microsoft.com/v1.0/me/messages
GET https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages
```

- `/me/messages` — all messages in the mailbox (including Deleted Items, Clutter)
- `/me/mailFolders/inbox/messages` — inbox only (recommended for our use case)

**Method:** GET
**Auth header:** `Authorization: Bearer {token}`

---

## 2. Query Parameters

| Parameter | Purpose | Example |
|-----------|---------|---------|
| `$filter` | OData filter expression | `receivedDateTime ge 2026-03-25T15:00:00Z` |
| `$select` | Choose specific fields | `from,subject,bodyPreview,receivedDateTime` |
| `$orderby` | Sort results | `receivedDateTime DESC` |
| `$top` | Limit result count (1-1000, default 10) | `$top=20` |
| `$skip` | Pagination offset | `$skip=10` |

---

## 3. Exact API Call Example

### Basic: Messages received after a timestamp, newest first

```
GET https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages
  ?$filter=receivedDateTime ge 2026-03-25T15:00:00Z
  &$orderby=receivedDateTime DESC
  &$select=from,subject,bodyPreview,receivedDateTime
  &$top=20
```

### With sender filter (e.g., only from a specific address)

```
GET https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages
  ?$filter=receivedDateTime ge 2026-03-25T00:00:00Z and from/emailAddress/address eq 'someone@example.com'
  &$orderby=receivedDateTime DESC
  &$select=from,subject,bodyPreview,receivedDateTime
  &$top=10
```

---

## 4. CRITICAL: $filter + $orderby Constraint

When using `$filter` and `$orderby` together, you MUST follow these rules or you get `InefficientFilter` error:

1. Properties in `$orderby` **must also appear** in `$filter`
2. Properties in `$orderby` must be in the **same order** as in `$filter`
3. Properties in `$orderby` must appear **before** other filter properties in `$filter`

**This means:** if you want `$orderby=receivedDateTime DESC`, then `receivedDateTime` MUST be in your `$filter` clause (e.g., `receivedDateTime ge 2026-01-01T00:00:00Z`).

---

## 5. $filter Date Syntax

OData date comparison operators:
- `ge` — greater than or equal (after or on)
- `gt` — greater than (strictly after)
- `le` — less than or equal (before or on)
- `lt` — less than (strictly before)
- `eq` — equals

**Format:** ISO 8601 UTC — `YYYY-MM-DDTHH:MM:SSZ`
**No quotes around date values** in $filter expressions.

```
receivedDateTime ge 2026-03-25T15:00:00Z
receivedDateTime ge 2026-03-25T00:00:00Z and receivedDateTime lt 2026-03-26T00:00:00Z
```

---

## 6. bodyPreview Field

- **Type:** String
- **Content:** The first **255 characters** of the message body
- **Format:** Always **plain text** (never HTML), even if the message body is HTML
- **Length control:** Cannot be changed — always truncated at 255 chars
- **Use case:** Perfect for a quick summary without fetching the full body

---

## 7. Authentication / Permissions

### Required Permission
**`Mail.Read`** (delegated) — least privileged option for reading messages.

Alternatives:
- `Mail.ReadBasic` — even less privileged, returns metadata only (no body/bodyPreview/attachments)
- `Mail.ReadWrite` — read + write (overkill for reading)

### Existing Token
The workflow already uses MS Graph OAuth (delegated) to **send email** (`Mail.Send` permission). To read messages, the token also needs `Mail.Read` scope.

**Action needed:** Check if the existing OAuth credential in n8n has `Mail.Read` in its scopes. If not, the scope must be added and the user must re-consent.

To check in n8n: Credentials > Microsoft OAuth2 > check the scopes field.

---

## 8. Rate Limits

| Metric | Limit |
|--------|-------|
| Requests per 10 minutes | 10,000 per app per mailbox |
| Concurrent requests | 4 per app per mailbox |
| Global limit | 130,000 per 10 seconds across all tenants |

**For our use case (1-2 calls per day):** Zero concern. We are orders of magnitude below any throttling threshold.

---

## 9. Response Format

```json
{
  "@odata.context": "...",
  "@odata.nextLink": "...(if more pages)...",
  "value": [
    {
      "receivedDateTime": "2026-03-25T16:30:00Z",
      "subject": "Re: Tax documents for 2025",
      "bodyPreview": "Hi, I've attached the requested documents...",
      "from": {
        "emailAddress": {
          "name": "John Doe",
          "address": "john@example.com"
        }
      }
    }
  ]
}
```

**Notes:**
- `from` is a nested object: `from.emailAddress.name` and `from.emailAddress.address`
- Default page size: 10 messages. Use `$top` to change (max 1000).
- If more results exist, `@odata.nextLink` contains the URL for the next page.

---

## 10. n8n Implementation Notes

In n8n, use the **HTTP Request** node with MS Graph OAuth2 credential:

```
URL: https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages
Method: GET
Query Parameters:
  $filter: receivedDateTime ge {{timestamp}}
  $orderby: receivedDateTime DESC
  $select: from,subject,bodyPreview,receivedDateTime
  $top: 20
Authentication: Predefined Credential Type > Microsoft OAuth2 API
```

Alternatively, n8n has a built-in **Microsoft Outlook** node that wraps this API — but the HTTP Request node gives more control over query parameters.

---

## Sources

- [List messages API](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0)
- [Message resource type](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0)
- [OData query parameters](https://learn.microsoft.com/en-us/graph/query-parameters)
- [$filter + $orderby Q&A](https://learn.microsoft.com/en-us/answers/questions/656200/graph-api-to-filter-results-on-from-and-subject-an)
- [Throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits)
