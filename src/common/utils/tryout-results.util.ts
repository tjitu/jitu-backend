/** Results are released at the scheduled end; an unset date stays unavailable. */
export function areTryoutResultsAvailable(scheduledEnd: Date | null | undefined, now = new Date()): boolean {
  return scheduledEnd != null && scheduledEnd.getTime() <= now.getTime();
}
