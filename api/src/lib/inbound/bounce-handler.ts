import type { BounceInfo } from './bounce-detector';
import { logEvent } from '../activity-logger';
import { AirtableClient } from '../airtable';
import { TABLES } from './types';

interface ClientFields {
  client_id?: string;
  email?: string;
  email_bounced?: boolean;
  last_bounced_email?: string;
}

export async function handleHardBounce(
  airtable: AirtableClient,
  bounce: BounceInfo,
  messageId: string,
): Promise<void> {
  const recipient = bounce.failedRecipient.toLowerCase();
  // Lowercase + escape both sides so the Airtable formula is case-insensitive and quote-safe.
  const escapedRecipient = recipient.replace(/'/g, "\\'");

  const matches = await airtable.listAllRecords<ClientFields>(TABLES.CLIENTS, {
    filterByFormula: `LOWER({email})='${escapedRecipient}'`,
  });

  if (matches.length === 0) {
    logEvent({
      event_type: 'email_bounce_unmatched',
      category: 'INBOUND',
      details: { recipient, reason: bounce.reasonCode, message_id: messageId },
    });
    return;
  }

  for (const client of matches) {
    if (
      client.fields.last_bounced_email === recipient &&
      (!client.fields.email || client.fields.email === '')
    ) continue;

    const clientCpaId = client.fields.client_id ?? '';

    await airtable.updateRecord(TABLES.CLIENTS, client.id, {
      email: '',
      email_bounced: true,
      last_bounced_email: recipient,
      email_bounce_reason: bounce.reasonText,
      email_bounce_at: new Date().toISOString(),
    });

    let revertedCount = 0;
    if (clientCpaId) {
      const escapedCpa = clientCpaId.replace(/'/g, "\\'");
      const reports = await airtable.listAllRecords<{ stage?: string }>(TABLES.REPORTS, {
        filterByFormula: `AND({client_id}='${escapedCpa}',{stage}='Waiting_For_Answers')`,
      });

      for (const r of reports) {
        await airtable.updateRecord(TABLES.REPORTS, r.id, { stage: 'Send_Questionnaire' });
        logEvent({
          event_type: 'stage_reverted_on_bounce',
          category: 'INBOUND',
          client_id: clientCpaId,
          details: {
            from: 'Waiting_For_Answers',
            to: 'Send_Questionnaire',
            report_id: r.id,
            reason: bounce.reasonCode,
          },
        });
      }
      revertedCount = reports.length;
    }

    logEvent({
      event_type: 'email_bounce_handled',
      category: 'INBOUND',
      client_id: clientCpaId,
      details: {
        recipient,
        reason: bounce.reasonCode,
        cleared_email: true,
        reports_reverted: revertedCount,
      },
    });
  }
}
