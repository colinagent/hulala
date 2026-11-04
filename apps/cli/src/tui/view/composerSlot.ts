/**
 * The dock slot that holds either the composer or a selector.
 *
 * pi replaces its editor with the model/login pickers instead of floating a
 * dialog over the conversation (`editorContainer` in `interactive-mode`). The
 * same swap happens here: the layout always contains this slot, and `/model`
 * and `/login` put their panel in it so the selectors frame themselves with
 * full-width rules above the status bar, exactly where the composer was.
 *
 * @module hulala-cli/tui/view/composerSlot
 */
import type { Component } from '@earendil-works/pi-tui'

export class ComposerSlot implements Component {
  private readonly composer: Component
  private active: Component

  constructor(composer: Component) {
    this.composer = composer
    this.active = composer
  }

  /** Whether a selector currently owns the slot. */
  get replaced(): boolean {
    return this.active !== this.composer
  }

  /** Put `component` where the composer was. */
  show(component: Component): void {
    this.active = component
  }

  /** Put the composer back. */
  restore(): void {
    this.active = this.composer
  }

  render(width: number): string[] {
    return this.active.render(width)
  }

  invalidate(): void {
    this.active.invalidate()
  }
}
