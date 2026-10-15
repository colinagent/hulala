function isInternalTreeTransfer(dataTransfer: DataTransfer | null | undefined) {
  const text = (dataTransfer?.getData('text/plain') || '').trim();
  const types = Array.from(dataTransfer?.types || []);
  return text.startsWith('hulala-file:')
    || text.startsWith('hulala-dir:')
    || text === 'hulala-tree-transfer'
    || types.includes('application/x-hulala-file-tree-items');
}

export function hasExternalTreeImportPayload(dataTransfer: DataTransfer | null | undefined) {
  if (!dataTransfer || isInternalTreeTransfer(dataTransfer)) {
    return false;
  }
  if (Array.from(dataTransfer.items || []).some((item) => item.kind === 'file')) {
    return true;
  }
  return Array.from(dataTransfer.types || []).includes('Files');
}
