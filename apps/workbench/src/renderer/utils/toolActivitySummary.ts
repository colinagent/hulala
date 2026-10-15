export function getToolActivityDetailPreview(detail: string): string {
  return (detail || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';
}
