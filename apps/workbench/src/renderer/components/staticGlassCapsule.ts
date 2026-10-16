/** Static Glass is an opaque mix of the declared substrate and white. */
export const OP_SG_CAPSULE = 'op-sg-capsule';
export const OP_SG_SURFACE = 'op-sg-surface';
export const OP_POPUP_MENU = `${OP_SG_SURFACE} op-popup-menu`;
export const OP_SG_ON_SIDEBAR = 'op-sg--on-sidebar';
export const OP_SG_ON_TITLEBAR = 'op-sg--on-titlebar';
export const OP_SG_ON_EDITOR = 'op-sg--on-editor';
export const OP_SG_ON_OVERLAY = 'op-sg--on-overlay';

/** Tight chrome rows — same Static Glass surface with a short, unclipped elevation. */
export const OP_SG_CAPSULE_COMPACT_SHADOW = 'op-sg-capsule--compact-shadow';
export const UI_PILL_BTN_PRIMARY = 'ui-pill-btn-primary';
export const UI_PILL_BTN_SECONDARY = 'ui-pill-btn-secondary';
/** Compact pill — inline adjunct; width >= 2x height. */
export const UI_PILL_BTN_COMPACT = 'ui-pill-btn--compact';
/** Dialog footer paired CTAs — 112px min-width. */
export const UI_PILL_BTN_DIALOG = 'ui-pill-btn--dialog';
/** Content-width pills with no minimum width floor. */
export const UI_PILL_BTN_FIT = 'ui-pill-btn--fit';

/** Resolved shared tokens for UI rendered in a separate document. */
const STATIC_GLASS_VARIABLES = [
  '--op-sg-fill', '--op-sg-capsule-border', '--op-sg-capsule-border-width',
  '--op-sg-capsule-text', '--op-sg-capsule-shadow', '--op-sg-noise-image',
  '--op-sg-noise-grain', '--op-sg-noise', '--op-sg-noise-blend',
] as const;

export type StaticGlassVariables = Partial<Record<
  typeof STATIC_GLASS_VARIABLES[number] | '--op-sg-hover-text' | '--op-sg-highlight-text', string
>>;

export function readStaticGlassVariables(element: Element = document.documentElement): StaticGlassVariables {
  const style = getComputedStyle(element);
  const variables: StaticGlassVariables = {};
  for (const name of STATIC_GLASS_VARIABLES) {
    const value = style.getPropertyValue(name).trim();
    if (value) variables[name] = value;
  }
  variables['--op-sg-hover-text'] = style.getPropertyValue('--color-brand').trim();
  variables['--op-sg-highlight-text'] = style.getPropertyValue('--color-highlight').trim();
  return variables;
}
