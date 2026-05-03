export interface BounceInfo {
  failedRecipient: string;
  reasonCode: 'dns_not_found' | 'mailbox_not_found' | 'rejected' | 'other';
  reasonText: string;
  isHard: boolean;
}

const SUBJECT_PATTERNS = [
  /^undeliverable[: ]/i,
  /^delivery status notification/i,
  /^delivery has failed/i,
  /^non[- ]delivery/i,
  /המסירה.*נכשלה/,
  /דואר.*לא הצליח להישלח/,
];

const SENDER_PATTERNS = [
  /^postmaster@/i,
  /^mailer-daemon@/i,
  /^microsoftexchange.*@/i,
];

const OFFICE_ADDRESS = 'reports@moshe-atsits.co.il';

const EMAIL_TOKEN = /[\w.+-]+@[\w.-]+\.\w+/;

const RECIPIENT_PATTERNS: RegExp[] = [
  /(?:Final-Recipient|Original-Recipient)[^\n]*?:\s*(?:rfc822;\s*)?([\w.+-]+@[\w.-]+\.\w+)/i,
  /([\w.+-]+@[\w.-]+\.\w+)\s*(?:לא נמצא|not found|does not exist)/i,
  /(?:לכתובת|To)[:\s]+([\w.+-]+@[\w.-]+\.\w+)/i,
];

function matchesSubject(subject: string): boolean {
  return SUBJECT_PATTERNS.some(p => p.test(subject));
}

function matchesSender(fromAddress: string): boolean {
  return SENDER_PATTERNS.some(p => p.test(fromAddress));
}

function extractRecipient(body: string): string | null {
  for (const pattern of RECIPIENT_PATTERNS) {
    const m = body.match(pattern);
    if (m) return m[1].toLowerCase();
  }
  const tokens = body.match(new RegExp(EMAIL_TOKEN.source, 'g')) ?? [];
  const fallback = tokens.find(t => t.toLowerCase() !== OFFICE_ADDRESS);
  return fallback ? fallback.toLowerCase() : null;
}

function classifyReason(body: string): Pick<BounceInfo, 'reasonCode' | 'reasonText' | 'isHard'> {
  if (/DNS|תחום של הנמען לא קיים|domain.*not.*exist|host.*unknown|5\.1\.2|5\.4\.1/i.test(body)) {
    return { reasonCode: 'dns_not_found', reasonText: 'DNS not found', isHard: true };
  }
  if (/לא נמצא|user unknown|mailbox.*not.*(?:exist|found)|recipient.*not.*found|5\.1\.1/i.test(body)) {
    return { reasonCode: 'mailbox_not_found', reasonText: 'Mailbox not found', isHard: true };
  }
  if (/rejected|denied|5\.7\.1/i.test(body)) {
    return { reasonCode: 'rejected', reasonText: 'Domain rejected', isHard: true };
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

  const failedRecipient = extractRecipient(body);
  if (!failedRecipient) return null;

  const classification = classifyReason(body);
  return { failedRecipient, ...classification };
}
