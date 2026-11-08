/**
 * Preset keys the client names itself, and the one label function.
 *
 * The Host owns the preset list; the client only decides how a key is written
 * down. The three shipped keys get product labels from the active language
 * table, a configured name always wins, and a custom key keeps its
 * conventional form. The selector and the status band share this so the same
 * preset never reads differently in two places.
 *
 * @module hulala-cli/tui/view/permission
 */
import { t } from '../i18n/index.js'

/** The built-in preset that lowers confirmation steps, so it asks first. */
export const FULL_ACCESS_PRESET = 'danger-full-access'

/** The experimental review preset, rendered with an `EXP` badge. */
export const AUTO_REVIEW_PRESET = 'auto'

/** Kebab-case presets get title-case labels, matching the Web client. */
function titleCase(value: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/u.test(value)) return value
  return value.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * The label one preset is shown under.
 *
 * A configured name always wins; the built-in keys fall back to their product
 * labels, and an unnamed custom preset keeps its conventional form.
 * @param value - preset key.
 * @param name - Host-supplied label, usually the key itself.
 * @returns the label to render.
 */
export function permissionLabel(value: string, name?: string): string {
  if (name !== undefined && name !== value) return name
  switch (value) {
    case 'read-only': return t('permission.preset.readOnly')
    case 'workspace-write': return t('permission.preset.workspaceWrite')
    case FULL_ACCESS_PRESET: return t('permission.preset.fullAccess')
    case 'custom': return t('permission.preset.custom')
    case AUTO_REVIEW_PRESET: return t('permission.preset.auto')
    default: return titleCase(name ?? value)
  }
}
