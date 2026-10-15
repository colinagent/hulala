import React from 'react';

import { useUiStore } from '../store/uiStore';
import { resolveFileIcon, SETI_FILE_ICON_FONT_SIZE } from '../utils/setiFileIcon';

type FileTypeIconProps = {
  filePath?: string | null;
  fileName?: string | null;
  editorId?: string | null;
  languageId?: string | null;
  className?: string;
};

export function FileTypeIcon({
  filePath,
  fileName,
  editorId,
  languageId,
  className = '',
}: FileTypeIconProps) {
  const scheme = useUiStore((state) => state.theme.scheme);
  const icon = resolveFileIcon({
    filePath,
    fileName,
    editorId,
    languageId,
    scheme,
  });

  return (
    <span
      aria-hidden="true"
      className={`op-file-type-icon ${className}`.trim()}
      data-file-icon-definition={icon.definitionId}
      data-file-icon-source={icon.source}
      style={{ color: icon.color, fontSize: SETI_FILE_ICON_FONT_SIZE }}
    >
      {icon.glyph}
    </span>
  );
}
