import { generateClientToken } from './client-token';

export const FRONTEND_BASE = 'https://docs.moshe-atsits.com';

export async function buildQuestionnaireUrl(
  reportId: string,
  clientSecretKey: string,
): Promise<string> {
  const token = await generateClientToken(reportId, clientSecretKey);
  return `${FRONTEND_BASE}/?report_id=${reportId}&token=${encodeURIComponent(token)}`;
}
