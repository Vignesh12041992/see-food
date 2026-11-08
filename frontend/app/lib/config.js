export const DEFAULT_API_BASE_URL = 'http://localhost:8000';

/**
 * Builds the URL of the analyze endpoint from the backend's base URL.
 * Falls back to local development when no base URL is configured, and
 * tolerates trailing slashes and surrounding whitespace.
 */
export function buildAnalyzeUrl(baseUrl) {
  const base = (baseUrl || '').trim() || DEFAULT_API_BASE_URL;
  return `${base.replace(/\/+$/, '')}/api/analyze-nutrition`;
}
