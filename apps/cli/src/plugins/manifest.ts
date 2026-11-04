/**
 * The `hulala.plugin` manifest: what a plugin package has to declare to be loaded.
 *
 * It is deliberately the smallest thing that can be checked without running the
 * plugin, because everything that can be verified up front is a failure the user
 * never sees: a missing entry, a version the client does not implement, a
 * field with the wrong type.
 *
 * The field mirrors DSH's `dsh.client` and `dsh.bundle` declarations. A package
 * may carry both — a client plugin and a Host bundle are different surfaces of the
 * same plugin — so this reads only its own key and leaves the rest alone.
 *
 * @module hulala-cli/plugins/manifest
 */

/** The plugin API version this client implements. */
export const PLUGIN_API_VERSION = 1

/**
 * The oldest plugin API this client still runs.
 *
 * It equals {@link PLUGIN_API_VERSION} today because nothing has been removed
 * yet. It exists so that the *first* removal is a one-line change with a clear
 * failure, instead of an invitation to quietly break every installed plugin:
 * bump `PLUGIN_API_VERSION`, raise this to the first version that still works,
 * and older plugins are refused by name at load time.
 *
 * The rule that keeps this cheap: **the contract only grows.** A field may be
 * added; a field never changes meaning inside one version.
 */
export const PLUGIN_MIN_API_VERSION = 1

import type { PluginManifest } from '@hulala/plugin-sdk'

export type { PluginManifest }

/** Why a candidate directory is not a plugin. */
export interface ManifestProblem {
  readonly id: string
  readonly message: string
}

/** A successful read. */
export interface ManifestRead {
  readonly manifest: PluginManifest
}

/**
 * Read the `hulala.plugin` declaration out of one `package.json` value.
 * @param id - directory name, used as a fallback identity and in messages.
 * @param directory - absolute directory the manifest lives in.
 * @param value - the parsed `package.json`.
 * @returns the manifest, or the reason it cannot be one.
 */
export function readManifest(id: string, directory: string, value: unknown): ManifestRead | ManifestProblem {
  if (value === null || typeof value !== 'object') return { id, message: 'package.json is not an object' }
  const record = value as Record<string, unknown>
  const name = typeof record.name === 'string' && record.name !== '' ? record.name : id
  const version = typeof record.version === 'string' ? record.version : '0.0.0'
  const description = typeof record.description === 'string' ? record.description : undefined

  const hulala = record.hulala
  if (hulala === null || typeof hulala !== 'object') {
    return { id, message: 'package.json declares no "hulala" section' }
  }
  const tui = (hulala as Record<string, unknown>).tui
  if (tui === null || typeof tui !== 'object') {
    return { id, message: 'package.json declares no "hulala.plugin" section' }
  }
  const declaration = tui as Record<string, unknown>

  const apiVersion = declaration.apiVersion
  if (typeof apiVersion !== 'number' || !Number.isInteger(apiVersion) || apiVersion < 1) {
    return { id, message: '"hulala.plugin.apiVersion" must be a positive integer' }
  }
  if (apiVersion > PLUGIN_API_VERSION) {
    return {
      id,
      message: `the plugin targets API ${apiVersion}; this client implements ${PLUGIN_API_VERSION}`,
    }
  }
  if (apiVersion < PLUGIN_MIN_API_VERSION) {
    // The dangerous direction: an old plugin loads happily and then calls an API
    // that no longer exists, which looks like a bug in the client.
    return {
      id,
      message: `the plugin targets API ${apiVersion}; this client requires at least ${PLUGIN_MIN_API_VERSION}`,
    }
  }

  const entry = declaration.entry
  if (typeof entry !== 'string' || entry === '' || !entry.startsWith('./')) {
    return { id, message: '"hulala.plugin.entry" must be a "./"-relative path' }
  }
  if (entry.includes('..')) {
    return { id, message: '"hulala.plugin.entry" must stay inside the package' }
  }

  return {
    manifest: {
      id,
      name,
      version,
      ...(description === undefined ? {} : { description }),
      apiVersion,
      entry,
      directory,
    },
  }
}

/** Whether a manifest read failed. */
export function isProblem(read: ManifestRead | ManifestProblem): read is ManifestProblem {
  return 'message' in read
}
