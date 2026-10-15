import { StateEffect } from '@codemirror/state';

export const refreshLivePreviewDecorationsEffect = StateEffect.define<null>();
export const refreshLivePreviewViewportDecorationsEffect = StateEffect.define<Array<{ from: number; to: number }>>();
