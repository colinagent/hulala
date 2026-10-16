export function shouldUseBlockWidgetMouseSelection(params: {
  button: number;
  hasModifier: boolean;
  startPos: number | null;
  startInBlockWidgetRange: boolean;
  startInBlockWidgetDom: boolean;
}): boolean {
  if (params.button !== 0 || params.hasModifier || params.startPos === null) {
    return false;
  }
  return params.startInBlockWidgetRange || params.startInBlockWidgetDom;
}
