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

test('Fixture D — Outlook MicrosoftExchange NDR with Hebrew prefix on subject (real DL-399 incident)', () => {
  const result = detectBounce(
    '‏‏לא ניתן למסירה: Undeliverable: שאלון — דוח שנתי 2025 | ליעוז שור',
    'microsoftexchange329e71ec88ae4615bbc36ab6ce41109e@mosheatsits.onmicrosoft.com',
    [
      "Your message wasn't delivered to nonexistent-dl399@example.invalid because the address couldn't be found",
      'or the domain does not exist.',
      'Original sender: reports@moshe-atsits.co.il',
      'Recipient: nonexistent-dl399@example.invalid',
    ].join('\n'),
  );
  assert.equal(result?.failedRecipient, 'nonexistent-dl399@example.invalid');
  assert.equal(result?.isHard, true);
});

test('Fixture E — sender-only (no subject match) still detects when body has clear NDR markers', () => {
  const result = detectBounce(
    'שאלון — דוח שנתי 2025',
    'postmaster@moshe-atsits.co.il',
    'Recipient: bad@example.invalid\ndomain does not exist',
  );
  assert.equal(result?.failedRecipient, 'bad@example.invalid');
  assert.equal(result?.reasonCode, 'dns_not_found');
});

test('Fixture F — fallback recipient extraction excludes office + sender domains', () => {
  const result = detectBounce(
    'Undeliverable',
    'postmaster@moshe-atsits.co.il',
    [
      'Sent from reports@moshe-atsits.co.il',
      'Internal relay: microsoftexchange@mosheatsits.onmicrosoft.com',
      'Failed recipient: real-bad@example.invalid',
    ].join('\n'),
  );
  assert.equal(result?.failedRecipient, 'real-bad@example.invalid');
});
