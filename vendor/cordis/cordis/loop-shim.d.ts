/** Loop-only type surface. Upstream source stays the runtime entry. */
export class Context {
  effect(execute: () => () => void, label?: string): () => void | Promise<void>;
}
