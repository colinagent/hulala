import React from 'react';
import { useTranslation } from 'react-i18next';
import { BrandMark } from '../Brand/BrandMark';
import { FolderIcon, RemoteIcon } from '../Icons';
import {
  OP_SG_CAPSULE,
  OP_SG_ON_EDITOR,
  UI_PILL_BTN_PRIMARY,
  UI_PILL_BTN_SECONDARY,
} from '../staticGlassCapsule';

type NewWindowLandingProps = {
  openingFolder?: boolean;
  onOpenFolder: () => void;
  onConnectRemote: () => void;
};

export const NewWindowLanding: React.FC<NewWindowLandingProps> = ({
  openingFolder = false,
  onOpenFolder,
  onConnectRemote,
}) => {
  const { t } = useTranslation('shell');
  const LANDING_SHIFT_PX = 104;

  return (
    <div className="relative h-full w-full flex items-center justify-center bg-editor-bg text-editor-fg">
      <div className="draggable ui-titlebar absolute inset-x-0 top-0 h-[35px]" aria-hidden="true" />
      <div
        className="flex flex-col items-center gap-7"
        style={{ transform: `translateY(-${LANDING_SHIFT_PX}px)` }}
      >
        <BrandMark />
        <div className="flex items-center gap-4">
          <button
            type="button"
            className={`${UI_PILL_BTN_PRIMARY} ${OP_SG_CAPSULE} ${OP_SG_ON_EDITOR} min-w-[190px] h-12 gap-2 px-5 text-base disabled:opacity-50 disabled:cursor-not-allowed`}
            onClick={onOpenFolder}
            disabled={openingFolder}
          >
            <FolderIcon className="w-5 h-5" />
            <span>{t('landing.openFolder')}</span>
          </button>
          <button
            type="button"
            className={`${UI_PILL_BTN_SECONDARY} min-w-[190px] h-12 gap-2 px-5 text-base`}
            onClick={onConnectRemote}
          >
            <RemoteIcon className="w-5 h-5" />
            <span>{t('landing.connectRemote')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
