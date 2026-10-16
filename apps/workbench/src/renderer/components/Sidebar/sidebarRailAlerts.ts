import type { CronTaskRecord } from '../../services/cronService';
import type { SidebarRailItemKey } from './sidebarTabs';

/** Sidebar rail items that can show a numbered attention badge. */
export type SidebarRailAlertKey = SidebarRailItemKey;

export type SidebarRailAlertMap = Partial<Record<SidebarRailAlertKey, number>>;

export function formatSidebarRailAlertCount(count: number): string {
  if (count <= 0) {
    return '0';
  }
  if (count > 99) {
    return '99+';
  }
  return String(count);
}

export function countCronErrors(records: CronTaskRecord[]): number {
  return records.filter((record) => Boolean(record.state?.lastError)).length;
}

export function sidebarRailAlertCount(
  alerts: SidebarRailAlertMap,
  itemKey: SidebarRailAlertKey,
): number {
  return alerts[itemKey] ?? 0;
}
