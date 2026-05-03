export interface BounceInfo {
  failedRecipient: string;
  reasonCode: 'dns_not_found' | 'mailbox_not_found' | 'rejected' | 'other';
  reasonText: string;
  isHard: boolean;
}

const SUBJECT_PATTERNS = [
  /\bundeliverable\b/i,
  /\bdelivery status notification\b/i,
  /\bdelivery has failed\b/i,
  /\bnon[- ]delivery\b/i,
  /לא ניתן למסירה/,
  /המסירה.*נכשלה/,
  /דואר.*לא הצליח להישלח/,
];

const SENDER_PATTERNS = [
  /^postmaster@/i,
  /^mailer-daemon@/i,
  /^microsoftexchange.*@/i,
];

const OFFICE_DOMAIN = /@(?:moshe-atsits\.co\.il|mosheatsits\.onmicrosoft\.com)$/i;

const EMAIL_TOKEN = /[\w.+-]+@[\w.-]+\.\w+/;

const RECIPIENT_PATTERNS: RegExp[] = [
  /(?:Final-Recipient|Original-Recipient)[^\n]*?:\s*(?:rfc822;\s*)?([\w.+-]+@[\w.-]+\.\w+)/i,
  /([\w.+-]+@[\w.-]+\.\w+)\s*(?:לא נמצא|not found|does not exist|wasn't found|couldn't be found)/i,
  /(?:Recipient|To|לכתובת|הנמען|לנמען)[:\s]+([\w.+-]+@[\w.-]+\.\w+)/i,
  /\bto\s+([\w.+-]+@[\w.-]+\.\w+)/i,
];

function matchesSubject(subject: string): boolean {
  return SUBJECT_PATTERNS.some(p => p.test(subject));
}

function matchesSender(fromAddress: string): boolean {
  return SENDER_PATTERNS.some(p => p.test(fromAddress));
}

function extractRecipient(body: string, fromAddress: string): string | null {
  for (const pattern of RECIPIENT_PATTERNS) {
    const m = body.match(pattern);
    if (m && !OFFICE_DOMAIN.test(m[1]) && m[1].toLowerCase() !== fromAddress.toLowerCase()) {
      return m[1].toLowerCase();
    }
  }
  const tokens = body.match(new RegExp(EMAIL_TOKEN.source, 'g')) ?? [];
  const fallback = tokens.find(t => {
    const low = t.toLowerCase();
    return !OFFICE_DOMAIN.test(low) && low !== fromAddress.toLowerCase();
  });
  return fallback ? fallback.toLowerCase() : null;
}

function classifyReason(
  body: string,
  senderIsNdrRobot: boolean,
): Pick<BounceInfo, 'reasonCode' | 'reasonText' | 'isHard'> {
  if (/DNS|תחום של הנמען לא קיים|domain.*not.*exist|host.*unknown|5\.1\.2|5\.4\.1/i.test(body)) {
    return { reasonCode: 'dns_not_found', reasonText: 'DNS not found', isHard: true };
  }
  if (/לא נמצא|user unknown|mailbox.*not.*(?:exist|found)|recipient.*not.*found|wasn't found|couldn't be found|5\.1\.1/i.test(body)) {
    return { reasonCode: 'mailbox_not_found', reasonText: 'Mailbox not found', isHard: true };
  }
  if (/rejected|denied|5\.7\.1/i.test(body)) {
    return { reasonCode: 'rejected', reasonText: 'Domain rejected', isHard: true };
  }
  if (senderIsNdrRobot) {
    return { reasonCode: 'other', reasonText: 'Delivery failed', isHard: true };
  }
  return { reasonCode: 'other', reasonText: 'Delivery failed', isHard: false };
}

export function detectBounce(
  subject: string,
  fromAddress: string,
  body: string,
): BounceInfo | null {
  const subjectMatch = matchesSubject(subject);
  const senderMatch = matchesSender(fromAddress);

  if (!subjectMatch && !senderMatch) return null;

  const failedRecipient = extractRecipient(body, fromAddress);
  if (!failedRecipient) return null;

  const classification = classifyReason(body, senderMatch);
  return { failedRecipient, ...classification };
}
