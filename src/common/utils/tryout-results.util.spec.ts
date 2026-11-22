import { areTryoutResultsAvailable } from './tryout-results.util';

describe('tryout result release', () => {
  const end = new Date('2026-11-23T12:00:00Z');
  it('releases results at the scheduled end and never for a missing end', () => {
    expect(areTryoutResultsAvailable(end, new Date(end.getTime() - 1))).toBe(false);
    expect(areTryoutResultsAvailable(end, end)).toBe(true);
    expect(areTryoutResultsAvailable(end, new Date(end.getTime() + 1))).toBe(true);
    expect(areTryoutResultsAvailable(null, end)).toBe(false);
  });
});
