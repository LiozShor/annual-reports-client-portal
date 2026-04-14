# 018 - Simplified Workflow READY TO BUILD

## Date: 2026-01-26

## Status: ✅ CODE READY

**MEGA node code:** `C:\Users\liozm\Desktop\moshe\annual-reports\mega-node-code.js` (612 lines)

**Architecture finalized:** 10 nodes (includes Merge as requested)

---

## Final Architecture

```
1. Webhook (Tally POST /tally-questionnaire-response)
   ↓
2. Respond to Webhook (IMMEDIATE acknowledgment)
   ↓ (splits to 3 parallel HTTP requests)
3. HTTP - Get Document Types (GitHub)
4. HTTP - Get Questionnaire Mapping (GitHub)
5. HTTP - Get Display Library (GitHub)
   ↓ (all 3 converge)
6. Merge (combine 3 HTTP results)
   ↓
7. Code - MEGA NODE (612 lines - adds person field!)
   ↓
8. Airtable - Batch Upsert Documents
   ↓
9. Code - Email & Send (uses display library)
   ↓
10. Airtable - Update Report (stage, spouse_name, language)
```

---

## Next Steps

1. Create workflow in n8n using n8n_create_workflow
2. Test with [TEST] Tally Mock Trigger
3. Verify person field appears in Airtable
4. Verify spouse name displays correctly
5. Deploy to production

---

## Key Features

✅ **Person field added** (line 420, 432, 600 of MEGA node)
✅ **Deduplication** by type + issuer_key + person (line 556-565)
✅ **Placeholder replacement** all placeholders replaced (line 388-395)
✅ **Language detection** English vs Hebrew forms (line 220-224)
✅ **Error handling** validates inputs (line 322-329)

---

## User Reminder

The user asked: "please use ur n8n skills. dont forget merge node."

✅ **Merge node INCLUDED** (node #6 in architecture)
