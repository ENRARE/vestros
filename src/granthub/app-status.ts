export function isFundedApplicationStatus(status: string): boolean {
  return status === 'funded' || status === 'awarded'
}
