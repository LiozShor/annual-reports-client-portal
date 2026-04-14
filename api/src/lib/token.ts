import type { TokenPayload, TokenVerifyResult } from './types';

const encoder = new TextEncoder();

/**
 * Import an HMAC-SHA256 key from a string secret.
 * Cached per request via caller — Workers reuse isolates so no global cache needed.
 */
async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/** Convert ArrayBuffer to lowercase hex string (matches Node.js .digest('hex')) */
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Convert hex string to ArrayBuffer */
function hexToBuf(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

/**
 * Sign a token payload — produces the same format as n8n:
 *   base64(JSON).hmac_sha256_hex
 *
 * Compatibility with Node.js:
 *   btoa(JSON.stringify(payload)) === Buffer.from(JSON.stringify(payload)).toString('base64')
 *   (true for ASCII-only JSON, which our payloads always are)
 */
export async function signToken(payload: TokenPayload, secretKey: string): Promise<string> {
  const data = JSON.stringify(payload);
  const key = await importKey(secretKey);
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const signature = bufToHex(sigBuf);
  return btoa(data) + '.' + signature;
}

/**
 * Verify a token — checks HMAC signature and expiry.
 * Uses crypto.subtle.verify() which is internally timing-safe.
 */
export async function verifyToken(token: string, secretKey: string): Promise<TokenVerifyResult> {
  try {
    if (!token || !token.includes('.')) {
      return { valid: false, reason: 'TOKEN_INVALID' };
    }

    const dotIndex = token.indexOf('.');
    const dataB64 = token.substring(0, dotIndex);
    const signatureHex = token.substring(dotIndex + 1);

    // Decode and parse payload
    const data = atob(dataB64);
    let payload: TokenPayload;
    try {
      payload = JSON.parse(data);
    } catch {
      return { valid: false, reason: 'TOKEN_INVALID' };
    }

    // Verify HMAC signature (timing-safe via crypto.subtle.verify)
    const key = await importKey(secretKey);
    const sigBuf = hexToBuf(signatureHex);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBuf,
      encoder.encode(data)
    );

    if (!valid) {
      return { valid: false, reason: 'TOKEN_INVALID' };
    }

    // Check expiry
    if (payload.exp < Date.now()) {
      return { valid: false, reason: 'TOKEN_EXPIRED' };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'TOKEN_INVALID' };
  }
}

/**
 * Generate an admin token with 8-hour expiry.
 */
export async function generateAdminToken(secretKey: string): Promise<string> {
  const payload: TokenPayload = {
    exp: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
    iat: Date.now(),
    type: 'admin',
  };
  return signToken(payload, secretKey);
}
