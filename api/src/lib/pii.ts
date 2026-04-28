/**
 * PII sanitization helpers for activity logging.
 * The activity logger must NEVER persist names, emails, phone numbers, or document filenames in clear text.
 * Only opaque IDs are safe to log.
 */

const encoder = new TextEncoder();

/**
 * Sanitize an IP address by zeroing the last octet (IPv4) or last segment (IPv6).
 * If the input is unparseable, returns "0.0.0.0".
 * Returns undefined if input is undefined.
 */
export function redactIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;

  // Try IPv6 first (contains colons)
  if (ip.includes(':')) {
    try {
      const parts = ip.split(':');
      // Zero the last segment
      parts[parts.length - 1] = '0';
      return parts.join(':');
    } catch {
      return '0.0.0.0';
    }
  }

  // Try IPv4 (contains dots)
  if (ip.includes('.')) {
    try {
      const parts = ip.split('.');
      if (parts.length === 4) {
        parts[3] = '0';
        return parts.join('.');
      }
    } catch {
      return '0.0.0.0';
    }
  }

  // Unparseable
  return '0.0.0.0';
}

/**
 * Run regex scrubber on free text to redact PII patterns.
 * Replaces:
 *   - Email pattern (\S+@\S+\.\S+) → "[redacted_email]"
 *   - Phone pattern (Israeli 0?5\d{8} | intl \+\d{8,15} | \d{3}-?\d{7}) → "[redacted_phone]"
 * Returns undefined if input is undefined.
 */
export function scrubText(input: string | undefined): string | undefined {
  if (!input) return undefined;

  let result = input;

  // Email pattern: anything@anything.anything (greedy, stops at non-word chars)
  result = result.replace(/\S+@\S+\.\S+/g, '[redacted_email]');

  // Phone patterns (Israeli + international)
  // Israeli: optional leading 0, then 5, then 8 digits (0?5\d{8})
  result = result.replace(/0?5\d{8}/g, '[redacted_phone]');
  // International: plus sign, 8-15 digits (\+\d{8,15})
  result = result.replace(/\+\d{8,15}/g, '[redacted_phone]');
  // Generic: 3 digits, optional dash, 7 digits (\d{3}-?\d{7})
  result = result.replace(/\d{3}-?\d{7}/g, '[redacted_phone]');

  return result;
}

export const DROPPED_KEYS: readonly string[] = [
  'email',
  'phone',
  'mobile',
  'name',
  'full_name',
  'first_name',
  'last_name',
  'hebrew_name',
  'filename',
  'file_name',
  'doc_name',
  'document_name',
  'address',
];

/**
 * Recursively sanitize a JSON-serializable object:
 *   1. DROPS keys named (case-insensitive): email, phone, mobile, name, full_name, first_name, last_name, hebrew_name, filename, file_name, doc_name, document_name, address
 *   2. Runs scrubText() on any string value
 *   3. Truncates the final JSON payload to maxBytes (suffix with "…[truncated]" if cut)
 * Returns undefined if input is undefined/null.
 * Returns {} if input is not an object.
 * Handles arrays by mapping recursively. Handles nested objects.
 */
export function sanitizeDetails(
  details: unknown,
  maxBytes: number = 4096
): Record<string, unknown> | undefined {
  if (details === null || details === undefined) return undefined;

  // If not an object/array, return empty
  if (typeof details !== 'object') return {};

  // Helper: check if a key should be dropped (case-insensitive)
  const shouldDrop = (key: string): boolean => {
    const lower = key.toLowerCase();
    return DROPPED_KEYS.some(k => k === lower);
  };

  // Helper: recursively sanitize values
  const sanitizeValue = (val: unknown): unknown => {
    if (val === null || val === undefined) return val;

    if (typeof val === 'string') {
      return scrubText(val);
    }

    if (Array.isArray(val)) {
      return val.map(item => sanitizeValue(item));
    }

    if (typeof val === 'object') {
      return sanitizeValue(val);
    }

    // Primitives: number, boolean, etc.
    return val;
  };

  // Helper: walk object recursively
  const walkObj = (obj: unknown): Record<string, unknown> => {
    if (typeof obj !== 'object' || obj === null) return {};

    if (Array.isArray(obj)) {
      // For arrays, return as object with numeric string keys (JSON.stringify does this anyway)
      const result: Record<string, unknown> = {};
      for (let i = 0; i < obj.length; i++) {
        const val = obj[i];
        if (typeof val === 'string') {
          result[i.toString()] = scrubText(val);
        } else if (typeof val === 'object' && val !== null) {
          result[i.toString()] = walkObj(val);
        } else {
          result[i.toString()] = val;
        }
      }
      return result;
    }

    // Plain object
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (shouldDrop(key)) continue; // Skip dropped keys

      if (typeof val === 'string') {
        result[key] = scrubText(val);
      } else if (typeof val === 'object' && val !== null) {
        result[key] = walkObj(val);
      } else {
        result[key] = val;
      }
    }
    return result;
  };

  const sanitized = walkObj(details);

  // Truncate to maxBytes
  let json = JSON.stringify(sanitized);
  const bytes = encoder.encode(json).byteLength;

  if (bytes > maxBytes) {
    // Need to truncate: iteratively remove characters until we fit
    // Reserve space for the suffix
    const suffix = '…[truncated]';
    const suffixBytes = encoder.encode(suffix).byteLength;
    const targetBytes = maxBytes - suffixBytes;

    // Binary search: find the longest prefix that fits
    let low = 0;
    let high = json.length;
    let bestLen = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = json.substring(0, mid);
      const candidateBytes = encoder.encode(candidate).byteLength;

      if (candidateBytes <= targetBytes) {
        bestLen = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    json = json.substring(0, bestLen) + suffix;
  }

  return sanitized;
}
