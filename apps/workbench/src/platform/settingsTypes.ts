/** Browser-safe configuration contracts; persistence belongs to the local Host. */
export type IdleSleepPolicy = 'off' | 'whileAppRunning'
export type KeybindingItem = {
  key: string
  command: string
  when?: string
  args?: unknown
  mac?: string
  linux?: string
  win?: string
}
