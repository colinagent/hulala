import React from 'react';

import { formatSidebarRailAlertCount } from './sidebarRailAlerts';

export type SidebarRailAlertBadgeProps = {
  count: number;
  className?: string;
};

/**
 * Generic numbered attention badge for sidebar activity-rail icon buttons.
 * Red pill with a white count — same visual language as messenger pending badges.
 */
export function SidebarRailAlertBadge({ count, className }: SidebarRailAlertBadgeProps) {
  if (count <= 0) {
    return null;
  }
  return (
    <span
      className={`sidebar-rail-alert-badge${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      {formatSidebarRailAlertCount(count)}
    </span>
  );
}
