/**
 * What a clipboard read becomes in the draft.
 *
 * A paste is text, the way pi does it: a screenshot or a copied file is stored
 * on the Host's machine and its **path** is inserted, so the model opens it with
 * its own tools and the user can see, keep and re-use what was pasted. That is
 * also the only shape that works behind `hulala ssh`: the model's tools run on
 * the Host, and a path from this machine's `/var/folders/...` names nothing
 * there, so anything that crosses is written on the far side first.
 *
 * The rules are here rather than in the command plugin because they are the part
 * with decisions in them — which paths are kept, which are copied — and the
 * plugin around them is only clipboard reading and cursor insertion.
 *
 * @module hulala-cli/tui/paste
 */
import { basename } from 'node:path'
import type { PasteFile } from './data/remote.js'
import { PASTE_MAX_BYTES, type ClipboardPaste, type PasteImageProblem } from './clipboard.js'

/** What one paste needs from the Host, injected so a test needs no daemon. */
export interface PasteTarget {
  /** Whether the Host's filesystem is this machine's. */
  readonly local: boolean
  /** Write one file on the Host and return the absolute path there. */
  readonly save: (file: PasteFile) => Promise<string>
  /** Read one file from this machine, for a copy that has to cross. */
  readonly read: (path: string) => Promise<Uint8Array>
}

/** What the draft receives: text, a list of paths, or the reason for nothing. */
export type PastedDraft =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'paths'; readonly paths: readonly string[] }
  | { readonly kind: 'refused'; readonly reason: PasteImageProblem }

/**
 * Turn one clipboard read into the draft's content.
 * @param pasted - what the clipboard held.
 * @param target - the Host's write side and this machine's read side.
 * @returns text to insert, paths to insert, or why there is nothing.
 */
export async function draftFromClipboard(pasted: ClipboardPaste, target: PasteTarget): Promise<PastedDraft> {
  if (pasted.kind === 'empty') return { kind: 'refused', reason: pasted.reason }
  if (pasted.kind === 'text') return { kind: 'text', text: pasted.text }
  if (pasted.kind === 'image') {
    const path = await target.save({
      data: Buffer.from(pasted.image.data, 'base64'),
      mediaType: pasted.image.mediaType,
    })
    return { kind: 'paths', paths: [path] }
  }
  // A local Host already has these files, and copying would only duplicate what
  // the user keeps editing; another machine has none of them, so the bytes cross
  // once and the stored copy's path is what goes into the draft.
  if (target.local) return { kind: 'paths', paths: [...pasted.paths] }
  const copied: string[] = []
  for (const path of pasted.paths) {
    const data = await target.read(path)
    // The same ceiling a screenshot gets: the route on the far side refuses
    // anything larger, and saying so here names the file that was too big.
    if (data.length > PASTE_MAX_BYTES) return { kind: 'refused', reason: 'too-large' }
    copied.push(await target.save({ data, name: basename(path) }))
  }
  return { kind: 'paths', paths: copied }
}
