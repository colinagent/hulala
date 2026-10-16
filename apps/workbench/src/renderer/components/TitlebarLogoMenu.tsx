import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FolderIcon, SettingsIcon, UserIcon } from './Icons';
import { IconButton } from './IconButton';
import { useDismissOnOutsideInteraction } from '../hooks/useDismissOnOutsideInteraction';
import { PopupMenu, PopupMenuItem } from './PopupMenu';

type TitlebarLogoMenuProps = {
  onOpenSettings: () => void;
  onOpenConfigFiles: () => void | Promise<void>;
};

export function TitlebarLogoMenu({
  onOpenSettings,
  onOpenConfigFiles,
}: TitlebarLogoMenuProps) {
  const { t } = useTranslation('menu');
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  useDismissOnOutsideInteraction({ active: menuOpen, onDismiss: closeMenu, insideRefs: [triggerRef, menuRef] });
  const triggerRect = triggerRef.current?.getBoundingClientRect();
  const menuPosition = triggerRect
    ? { left: Math.round(triggerRect.right + 4), bottom: Math.max(8, Math.round(window.innerHeight - triggerRect.bottom)) }
    : { left: 56, bottom: 8 };

  return (
    <div className="sidebar-user-menu relative z-50 flex no-drag">
      <IconButton
        ref={triggerRef}
        size={34}
        className="sidebar-user-menu-trigger sidebar-activity-button no-drag"
        onClick={() => setMenuOpen(open => !open)}
        title={t('settings')}
        aria-label={t('settings')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <UserIcon className="h-[18px] w-[18px]" />
      </IconButton>
      {menuOpen && createPortal(
        <PopupMenu ref={menuRef} plain className="fixed z-[9999] min-w-[190px] overflow-visible text-secondary-text no-drag shadow-lg" style={menuPosition}>
          <PopupMenuItem onClick={() => { onOpenSettings(); closeMenu(); }}>
            <SettingsIcon className="h-4 w-4 opacity-70" />{t('settings')}
          </PopupMenuItem>
          <PopupMenuItem onClick={() => { closeMenu(); void onOpenConfigFiles(); }}>
            <FolderIcon className="h-4 w-4 opacity-70" />{t('openConfigFiles')}
          </PopupMenuItem>
        </PopupMenu>,
        document.body,
      )}
    </div>
  );
}
