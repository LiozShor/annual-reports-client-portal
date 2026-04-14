import type { ClientTokenVerifyResult } from './types';

const encoder = new TextEncoder();

/**
 * Verify a client-facing HMAC token.
 *
 * Client token format (different from admin tokens):
 *   expiryUnix.hmacSha256Hex
 *   HMAC input: "{reportId}.{expiryUnix}"
 *   Secret: CLIENT_SECRET_KEY
 *   Expiry: Unix seconds (not milliseconds)
 *
 * Uses crypto.subtle.verify() for timing-safe comparison.
 */
export async function verifyClientToken(
  reportId: string,
  token: string,
  secretKey: string
): Promise<ClientTokenVerifyResult> {
  try {
    if (!token || !token.includes('.')) {
      return { valid: false, reason: 'INVALID_TOKEN' };
    }

    const [expiryStr, hmac] = token.split('.');
    const expiryUnix = parseInt(expiryStr, 10);

    if (isNaN(expiryUnix)) {
      return { valid: false, reason: 'INVALID_TOKEN' };
    }

    // Check expiry (Unix seconds)
    if (Math.floor(Date.now() / 1000) > expiryUnix) {
      return { valid: false, reason: 'TOKEN_EXPIRED' };
    }

    // Verify HMAC: sign "{reportId}.{expiryUnix}" and compare
    const data = `${reportId}.${expiryUnix}`;
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secretKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Convert hex HMAC to ArrayBuffer for verification
    const hmacBytes = new Uint8Array(hmac.length / 2);
    for (let i = 0; i < hmac.length; i += 2) {
      hmacBytes[i / 2] = parseInt(hmac.substring(i, i + 2), 16);
    }

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      hmacBytes.buffer,
      encoder.encode(data)
    );

    if (!valid) {
      return { valid: false, reason: 'INVALID_TOKEN' };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: 'INVALID_TOKEN' };
  }
}

/**
 * Generate a client-facing HMAC token.
 *
 * Format: expiryUnix.hmacSha256Hex
 * HMAC input: "{reportId}.{expiryUnix}"
 * Default TTL: 45 days
 */
export async function generateClientToken(
  reportId: string,
  secretKey: string,
  ttlDays: number = 45
): Promise<string> {
  const expiryUnix = Math.floor(Date.now() / 1000) + (ttlDays * 24 * 60 * 60);
  const data = `${reportId}.${expiryUnix}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const hex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `${expiryUnix}.${hex}`;
}
