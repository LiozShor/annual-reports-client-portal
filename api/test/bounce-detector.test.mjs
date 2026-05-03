import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBounce } from '../src/lib/inbound/bounce-detector.mjs';

test('Fixture A — DNS failure (Hebrew Outlook NDR)', () => {
  const result = detectBounce(
    'Undeliverable: שאלון — דוח שנתי 2025 | חנה אליעז',
    'postmaster@moshe-atsits.co.il',
    [
      'המסירה לנמענים או לקבוצות אלו נכשלה:',
      'hannah@tip-tap.co.il (hannah@tip-tap.co.il)',
      'לא היונה אפשרות למסור את ההודעה שלך. מערכת שמות התחומים (DNS) דיווחה שהתחום של הנמען לא קיים.',
    ].join('\n'),
  );
  assert.deepEqual(result, {
    failedRecipient: 'hannah@tip-tap.co.il',
    reasonCode: 'dns_not_found',
    reasonText: 'DNS not found',
    isHard: true,
  });
});

test('Fixture B — Mailbox not found (Hebrew Outlook NDR)', () => {
  const result = detectBounce(
    'Undeliverable: שאלון — דוח שנתי 2025 | רוני שסקין',
    'postmaster@moshe-atsits.co.il',
    [
      'לא היתה אפשרות למסור את ההודעה שלך ל- roni@cristalino.co.il.',
      'roni לא נמצא ב-cristalino.co.il.',
      'Office 365 reports',
    ].join('\n'),
  );
  assert.deepEqual(result, {
    failedRecipient: 'roni@cristalino.co.il',
    reasonCode: 'mailbox_not_found',
    reasonText: 'Mailbox not found',
    isHard: true,
  });
});

test('Fixture C — Hebrew out-of-office must NOT trigger', () => {
  const result = detectBounce(
    'Re: שאלון שנתי - אני בחופשה',
    'someclient@example.com',
    'שלום, אני בחופשה עד 15.5.2026 ואחזור לעצמך לאחר מכן. תודה על הסבלנות.',
  );
  assert.equal(result, null);
});
