export function formatPersianTimestamp(date = new Date()): string {
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

export function toIsoTimestamp(date = new Date()): string {
  return date.toISOString();
}
