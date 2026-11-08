import { describe, it, expect } from 'vitest';
import { buildAnalyzeUrl, DEFAULT_API_BASE_URL } from '../../app/lib/config';

describe('buildAnalyzeUrl', () => {
  it('defaults to the local backend when nothing is configured', () => {
    expect(DEFAULT_API_BASE_URL).toBe('http://localhost:8000');
    expect(buildAnalyzeUrl(undefined)).toBe('http://localhost:8000/api/analyze-nutrition');
    expect(buildAnalyzeUrl('')).toBe('http://localhost:8000/api/analyze-nutrition');
    expect(buildAnalyzeUrl('   ')).toBe('http://localhost:8000/api/analyze-nutrition');
  });

  it('uses the configured backend URL', () => {
    expect(buildAnalyzeUrl('https://see-food-api.vercel.app')).toBe(
      'https://see-food-api.vercel.app/api/analyze-nutrition'
    );
  });

  it('removes trailing slashes and whitespace', () => {
    expect(buildAnalyzeUrl(' https://api.example.com/// ')).toBe(
      'https://api.example.com/api/analyze-nutrition'
    );
  });
});
