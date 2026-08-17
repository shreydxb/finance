// Shared reply-text formatting. Split out of intake.ts so query/reply.ts
// (Taskiv #52) can reuse the exact same number/date formatting the receipt
// pipeline's replies use, without intake.ts and query/reply.ts importing
// each other — intake.ts imports query/reply.ts for the intent router (#50).

export function formatAmount(amount: number): string {
  return amount.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}
