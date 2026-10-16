export function getNormalizedFileExtension(filePath: string): string {
  const fileName = filePath.trim().replace(/\\/g, '/').split('/').pop() || '';
  const lastDot = fileName.lastIndexOf('.');
  return lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : '';
}

export function isFileExtensionOpenable(
  filePath: string,
  openableExtensions: readonly string[],
): boolean {
  if (openableExtensions.length === 0) {
    return true;
  }
  const extension = getNormalizedFileExtension(filePath);
  return openableExtensions.some(
    (allowedExtension) => allowedExtension.trim().toLowerCase() === extension,
  );
}
