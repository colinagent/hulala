import React from 'react';

import {
  OP_POPUP_MENU,
  OP_SG_ON_EDITOR,
  OP_SG_ON_OVERLAY,
  OP_SG_ON_SIDEBAR,
  OP_SG_ON_TITLEBAR,
} from './staticGlassCapsule';

export type PopupMenuSubstrate = 'editor' | 'overlay' | 'sidebar' | 'titlebar';

type PopupMenuProps = {
  /** Plain overlay panel — no Static Glass surface. */
  plain?: boolean;
  /** Explicit substrate is required because many menus render through portals. */
  substrate?: PopupMenuSubstrate;
} & React.HTMLAttributes<HTMLDivElement>;

const substrateClasses: Record<PopupMenuSubstrate, string> = {
  editor: OP_SG_ON_EDITOR,
  overlay: OP_SG_ON_OVERLAY,
  sidebar: OP_SG_ON_SIDEBAR,
  titlebar: OP_SG_ON_TITLEBAR,
};

type PopupMenuItemProps = {
  active?: boolean;
  highlighted?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export const PopupMenu = React.forwardRef<HTMLDivElement, PopupMenuProps>(
  ({ plain = false, substrate = 'editor', className, children, ...props }, ref) => {
    const classes = [
      plain ? 'border border-border bg-overlay-bg' : `${OP_POPUP_MENU} ${substrateClasses[substrate]}`,
      'rounded-lg',
      'p-1',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div ref={ref} className={classes} {...props}>
        {children}
      </div>
    );
  }
);

PopupMenu.displayName = 'PopupMenu';

export const PopupMenuItem = React.forwardRef<HTMLButtonElement, PopupMenuItemProps>(
  ({ active = false, highlighted = false, className, children, type, ...props }, ref) => {
    const stateClass = active
      ? 'text-brand font-medium hover:bg-hover-bg'
      : highlighted
        ? 'bg-hover-bg text-prime-text'
        : 'text-secondary-text hover:bg-hover-bg hover:text-prime-text';

    const classes = [
      'w-full',
      'px-2',
      'py-1.5',
      'text-left',
      'rounded',
      'flex',
      'items-center',
      'gap-2',
      'text-sm',
      'transition-[color,background-color]',
      stateClass,
      'disabled:text-tertiary-text',
      'disabled:cursor-not-allowed',
      'disabled:hover:bg-transparent',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button ref={ref} type={type ?? 'button'} className={classes} {...props}>
        {children}
      </button>
    );
  }
);

PopupMenuItem.displayName = 'PopupMenuItem';

export function PopupMenuSeparator() {
  return <div className="h-px bg-border my-1 mx-1" />;
}
