/** Generate a hex token (matches n8n's crypto.randomBytes(n).toString('hex')) */
export function generateHexToken(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
