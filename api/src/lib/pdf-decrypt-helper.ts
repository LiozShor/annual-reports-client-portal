/**
 * pdf-decrypt-helper.ts — DL-373
 *
 * Wraps @localonlytools/pdf-decrypt with a typed error taxonomy.
 * Password is NEVER logged here or in callers.
 */

import { decryptPDF, isEncrypted } from '@localonlytools/pdf-decrypt';

export type DecryptResult =
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; error: 'WRONG_PASSWORD' | 'UNSUPPORTED_ENCRYPTION' | 'NOT_ENCRYPTED' | 'DECRYPT_FAILED'; message: string };

export async function tryDecryptPDF(bytes: ArrayBuffer, password: string): Promise<DecryptResult> {
  if (!isEncrypted(new Uint8Array(bytes))) {
    return { ok: false, error: 'NOT_ENCRYPTED', message: 'PDF is not encrypted' };
  }

  try {
    const result = await decryptPDF(new Uint8Array(bytes), password);
    return { ok: true, bytes: result.buffer as ArrayBuffer };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (/wrong.?password|bad.?decrypt|incorrect.?password|invalid.?password/i.test(msg)) {
      return { ok: false, error: 'WRONG_PASSWORD', message: 'Wrong password' };
    }
    if (/unsupported|aes.?256|not.?support/i.test(msg)) {
      return { ok: false, error: 'UNSUPPORTED_ENCRYPTION', message: 'Unsupported encryption type — please unlock locally and re-upload' };
    }
    return { ok: false, error: 'DECRYPT_FAILED', message: msg };
  }
}
