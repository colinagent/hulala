/**
 * When the client may hold English for the surface that has the keyboard.
 *
 * The input-source ownership is a machine-wide side effect, so two facts decide
 * it and neither is enough alone:
 *
 * - **the policy of the focused surface** — a command surface (rail, selector,
 *   approval, Neovim in normal mode) reads keys as instructions and needs
 *   English; a text surface leaves the user's own source alone;
 * - **whether the window is in front** — a background window that keeps focus
 *   on an approval card must not switch the keyboard of the machine the user is
 *   typing into somewhere else.
 *
 * The gate remembers the pair and calls `acquire`/`release` only when the answer
 * changes, so the claim is always paired: one acquire per hold, one release per
 * give-back. Losing the window releases at once — the user's source comes back
 * the moment they look elsewhere; regaining it while a command surface still has
 * the keyboard acquires again.
 *
 * @module hulala-cli/tui/editor/imeOwnershipGate
 */
import type { ImePolicy } from '../pane/focus.js'

/** The two ends of the ownership, as the gate calls them. */
export interface ImeClaim {
  /** Take English for this window. */
  acquire(): void
  /** Give the user's own source back. */
  release(): void
}

/** The gate: a policy, a focus flag, and the claim they imply. */
export class ImeOwnershipGate {
  private policy: ImePolicy = 'text'
  private focused: boolean
  private holding = false

  /**
   * @param claim - the ownership's acquire/release pair.
   * @param focused - the window's focus at start; a terminal that never reports
   *   focus stays focused, which is the behaviour every machine had before.
   */
  constructor(private readonly claim: ImeClaim, focused = true) {
    this.focused = focused
  }

  /** Whether this window currently holds English. */
  get held(): boolean {
    return this.holding
  }

  /** The surface that has the keyboard changed what its keys mean. */
  setPolicy(policy: ImePolicy): void {
    this.policy = policy
    this.settle()
  }

  /** The window gained or lost the front. */
  setFocus(focused: boolean): void {
    if (focused === this.focused) return
    this.focused = focused
    this.settle()
  }

  private settle(): void {
    const hold = this.focused && this.policy === 'command'
    if (hold === this.holding) return
    this.holding = hold
    if (hold) this.claim.acquire()
    else this.claim.release()
  }
}
