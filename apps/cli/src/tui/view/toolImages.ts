/**
 * Durable tool-result images, drawn inline.
 *
 * A result never carries pixels: `read_image` commits the file to the Host's
 * attachment store and returns a reference, which this module trades back for
 * bytes through the Session's own attachment route. The bytes are cached by
 * attachment id — one read per image, and the same picture in two rows shares
 * it — and handed to pi-tui's `Image`, whose kitty placement the alternate
 * screen already keeps in step with scroll and resize (the welcome mark is the
 * same path). No entry is evicted: a row keeps the lines it drew, placement
 * bytes included, so dropping one would free nothing the transcript does not
 * already hold — while a redraw after eviction would put a row back on the Host
 * for bytes it had. What does end the cache is the Session: the transcript is
 * rebuilt on a switch, so the bytes go with the rows that drew them.
 *
 * The read is asynchronous and rendering is not, so a row asks for `lines()`
 * before the bytes exist: the picture simply appears on the frame that follows
 * the read. `revision(image)` is what makes that frame redraw the row it belongs
 * to — a settled read bumps that attachment's version, and each row compares the
 * versions of the images it actually draws.
 *
 * A terminal with no graphics protocol is never asked for the bytes at all: the
 * row prints the reference (`[Image: name image/png 800x600]`) instead, which is
 * also what a refused read leaves behind. Kitty is the protocol the alternate
 * screen keeps; an iTerm2 window is told so by pi-tui itself and lands on the
 * same fallback.
 *
 * Kitty transmits PNG only, so a JPEG, WebP or GIF waits one frame for
 * `./pngTranscoder` to load and register: while it loads the row draws nothing,
 * and when it settles the cached placements are invalidated and the row is
 * redrawn with the converted picture (or with the reference line, when the
 * library could not be loaded).
 *
 * @module hulala-cli/tui/view/toolImages
 */
import { Image, allocateImageId, getCapabilities, imageFallback } from '@earendil-works/pi-tui'
import type { ToolImage } from '../data/viewModel.js'
import { buildStyles } from './theme.js'
import { createPngTranscoder, type PngTranscoder } from './pngTranscoder.js'

/**
 * Cells one result image may claim.
 *
 * pi's own default, and the width a QR code or a screenshot still scans and
 * reads at; the height cap keeps a tall phone screenshot from swallowing the
 * conversation it belongs to.
 */
const IMAGE_COLUMNS = 60
const IMAGE_ROWS = 30

/** What one result image currently has to show. */
type ImageState =
  | { readonly status: 'pending' }
  | { readonly status: 'ready'; readonly base64: string }
  | { readonly status: 'failed' }

interface Entry {
  state: ImageState
  /**
   * One kitty id per attachment, for the life of the window.
   *
   * The same image may be drawn in two rows, and a column resize re-encodes the
   * placement; reusing the id makes both a replacement of the one picture rather
   * than a second copy on screen, exactly as the welcome mark does.
   */
  imageId: number
  component?: Image
  /** Whether this entry's placement has to be converted before it can be drawn. */
  readonly transcoded: boolean
  /** Bumps when this image's read or conversion settles; one row watches it. */
  version: number
}

/** Durable images for the transcript, with their bytes read at most once. */
export interface ToolImagery {
  /**
   * The lines one result image draws in a column `width` wide.
   *
   * The first call starts that image's read. Returns no lines while the bytes
   * (or the converter) are still on their way, the placement once they land, and
   * the reference line when the terminal cannot draw a picture or the read was
   * refused.
   * @param image - the durable reference a result carried.
   * @param width - columns available, indent included.
   * @returns rows to draw, empty while there is nothing to draw yet.
   */
  lines(image: ToolImage, width: number): string[]
  /**
   * Forget every cached image, placement ids included.
   *
   * The open Session is what a picture belongs to: a switch rebuilds the
   * transcript and drops the rows that drew it, so keeping the bytes would leave
   * one Session's worth behind for every Session the window ever visited. A read
   * still in flight when this runs is ignored when it lands.
   */
  clear(): void
  /**
   * This image's version: it changes when the read or the conversion settles.
   *
   * One counter per attachment, not one for the window: a row keys its cached
   * lines on the images it actually draws, so an image settling elsewhere does
   * not re-render every picture in the transcript.
   */
  revision(image: ToolImage): number
}

/** Everything the cache needs from its owner. */
export interface ToolImageryOptions {
  /** Read one image's bytes from the Host's attachment store. */
  readonly read: (image: ToolImage) => Promise<Uint8Array>
  /** Called once per settled read or conversion: the frame that draws it is due. */
  readonly onChange: () => void
  /** Whether the client draws colour, for the fallback line's ink. */
  readonly color: boolean
  /** Kitty's PNG converter; the window's own unless a test supplies one. */
  readonly transcoder?: PngTranscoder
}

/**
 * Build the transcript's image cache.
 * @param options - the Host read, the repaint hook and the colour flag.
 * @returns the cache the tool rows draw through.
 */
export function createToolImagery(options: ToolImageryOptions): ToolImagery {
  // One entry per attachment, for the life of the window. No eviction: a row
  // keeps the lines it drew, placement bytes included, so forgetting the entry
  // would free nothing the transcript does not still hold — and re-reading it
  // on a redraw would put a stalled terminal back on the Host.
  const entries = new Map<string, Entry>()
  const styles = buildStyles(options.color)
  const transcoder = options.transcoder ?? createPngTranscoder()

  /**
   * The converter settled: rows that waited on it have no picture drawn yet, so
   * drop the cached lines of every converted entry and ask for the frame that
   * draws them. A PNG entry keeps its placement, which is still what it wants.
   */
  const settled = (): void => {
    for (const entry of entries.values()) {
      if (!entry.transcoded) continue
      entry.component?.invalidate()
      entry.version += 1
    }
    options.onChange()
  }

  /** The reference line, for a terminal that cannot draw the bytes. */
  const fallback = (image: ToolImage): string => styles.cardMuted(imageFallback(
    image.mediaType,
    { widthPx: image.width, heightPx: image.height },
    image.name,
  ))

  const start = (image: ToolImage): Entry => {
    const entry: Entry = {
      state: { status: 'pending' },
      imageId: allocateImageId(),
      transcoded: image.mediaType !== 'image/png',
      version: 0,
    }
    entries.set(image.attachmentId, entry)
    const record = (next: ImageState): void => {
      // A cleared cache is the previous Session's: its answer is not this row's
      // to draw, and announcing it would only buy a repaint that starts over.
      if (!entries.has(image.attachmentId)) return
      entry.state = next
      entry.version += 1
      options.onChange()
    }
    void options.read(image).then(
      (bytes) => { record({ status: 'ready', base64: Buffer.from(bytes).toString('base64') }) },
      () => { record({ status: 'failed' }) },
    )
    return entry
  }

  return {
    lines(image, width) {
      // No placement means no read: an unsupported terminal gets the reference
      // it can act on (open it elsewhere) instead of bytes it cannot draw.
      if (getCapabilities().images === null) return [fallback(image)]
      const entry = entries.get(image.attachmentId) ?? start(image)
      if (entry.state.status === 'pending') return []
      if (entry.state.status === 'failed') return [fallback(image)]
      if (entry.transcoded) {
        // Kitty takes PNG alone. Waiting a frame beats drawing the reference
        // line and replacing it: the picture is already on its way.
        const ready = transcoder.ensure(settled)
        if (ready === 'loading') return []
        if (ready === 'unavailable') return [fallback(image)]
      }
      entry.component ??= new Image(
        entry.state.base64,
        image.mediaType,
        { fallbackColor: styles.cardMuted },
        {
          maxWidthCells: IMAGE_COLUMNS,
          maxHeightCells: IMAGE_ROWS,
          imageId: entry.imageId,
          ...(image.name === undefined ? {} : { filename: image.name }),
        },
      )
      return entry.component.render(width)
    },
    clear: () => { entries.clear() },
    revision: image => entries.get(image.attachmentId)?.version ?? 0,
  }
}
