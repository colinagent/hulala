/**
 * The shape of one client-language message table.
 *
 * Both tables implement this interface, so a key added here is a compile error
 * until every language has it. Entries that interpolate values are functions;
 * `t()` takes their parameters, so a caller cannot forget one either.
 *
 * @module hulala-cli/tui/i18n/messages
 */

/** Every string the terminal client itself writes. */
export interface MessageTable {
  'language.title': string
  'language.footer': string
  'language.optionEn': string
  'language.optionZh': string
  'language.problemEnv': (params: { value: string }) => string
  'language.problemConfig': (params: { reason: string }) => string
  'language.saveFailed': (params: { reason: string }) => string
  'language.changed': (params: { language: string }) => string

  'slash.help': string
  'slash.sessions': string
  'slash.new': string
  'slash.resume': string
  'slash.model': string
  'slash.thinking': string
  'slash.login': string
  'slash.rename': string
  'slash.cancel': string
  'slash.status': string
  'slash.editor': string
  'slash.terminal': string
  'slash.reasoning': string
  'slash.clear': string
  'slash.update': string
  'slash.quit': string
  'slash.language': string
  'list.moveHint': string

  'help.title': string
  'help.keys': string
  'help.close': string
  'help.key.submit': string
  'help.key.move': string
  'help.key.thinking': string
  'help.key.escape': string
  'help.key.exit': string
  'help.key.columns': string
  'help.key.railKeys': string
  'help.key.rail': string
  'help.key.more': string
  'help.key.mouse': string
  'help.columns': string

  'approval.title': string
  'approval.footer': string
  'confirm.title': string
  'confirm.body': string
  'confirm.failed': string
  'confirm.footer': string
  'conflict.title': string
  'conflict.body': (params: { name: string }) => string
  'conflict.detail': string
  'conflict.footer': string

  'question.title': string
  'question.custom': string
  'question.otherPrefix': string
  'question.footer.type': string
  'question.footer.confirm': string
  'question.footer.custom': string
  'question.footer.multi': string
  'question.footer.single': string

  'resume.title': string
  'resume.currentFolder': string
  'resume.allFolders': string
  'resume.noContent': string
  'resume.noSession': string
  'resume.running': string
  'resume.more': string
  'resume.footer': string

  'selector.model.noProviders': string
  'selector.model.hint': string
  'selector.model.search': string
  'selector.model.noMatch': string
  'selector.model.default': string
  'selector.model.reasoning': (params: { effort: string }) => string
  'selector.model.name': (params: { name: string }) => string
  'selector.model.notAvailable': string
  'selector.model.reasoningLabel': string
  'selector.model.footer': string
  'selector.login.selectTitle': string
  'selector.login.search': string
  'selector.login.configured': string
  'selector.login.notConfigured': string
  'selector.login.noMatch': string
  'selector.login.footer': string
  'selector.login.apiKeyTitle': (params: { provider: string }) => string
  'selector.login.apiKeyPrompt': (params: { provider: string }) => string
  'selector.login.storage': string
  'selector.login.footerKeys': string
  'selector.thinking.title': string
  'selector.thinking.default': string
  'selector.thinking.footer': string
  'selector.thinking.persists': string

  'status.disconnected': string
  'status.update': (params: { version: string }) => string
  'status.updateAvailable': (params: { version: string }) => string
  'status.label.host': string
  'status.label.session': string
  'status.label.cwd': string
  'status.label.model': string
  'status.label.pane': string
  'status.label.rail': string
  'status.label.chat': string
  'status.label.turn': string
  'status.value.focus': string
  'status.value.visible': string
  'status.value.hidden': string
  'status.value.running': string
  'status.value.idle': string

  'hint.rail': string
  'hint.terminal': string
  'hint.editor': string
  'hint.focus': string
  'hint.quit': string
  'hint.escape': string
  'hint.expand': string
  'hint.thinking': string
  'hint.queue': string
  'hint.commands': string

  'running.idle': string
  'running.elapsed': (params: { duration: string }) => string

  'pending.steering': string
  'pending.followUp': string
  'pending.attachments': string
  'pending.editHint': string

  'rail.search': string
  'rail.newRow': string
  'rail.newLabel': string
  'rail.more': (params: { hidden: number }) => string
  'rail.less': string
  'rail.all': string
  'rail.now': string
  'rail.minutes': (params: { n: number }) => string
  'rail.hours': (params: { n: number }) => string
  'rail.days': (params: { n: number }) => string
  'rail.months': (params: { n: number }) => string
  'rail.years': (params: { n: number }) => string
  'rail.tooNarrow': string

  'transcript.summary': string
  'tool.in': string
  'tool.out': string
  'tool.moreLines': (params: { n: number }) => string
  'tool.exit': (params: { code: string }) => string
  'tool.signal': (params: { signal: string }) => string
  'think.label': string

  'banner.interrupt': string
  'banner.clearExit': string
  'banner.commands': string
  'banner.bash': string
  'banner.sessions': string
  'banner.terminal': string
  'banner.editor': string
  'banner.chat': string
  'banner.expand': string
  'banner.more': string

  'notice.cancelRequested': string
  'notice.renamed': (params: { title: string }) => string
  'notice.noQueued': string
  'notice.restored': (params: { count: number }) => string
  'notice.kept': (params: { count: number }) => string
  'notice.reasoning': (params: { mode: string }) => string
  'notice.model': (params: { selection: string }) => string
  'notice.thinking': (params: { level: string }) => string
  'notice.createdSession': (params: { id: string }) => string
  'notice.savedKey': (params: { provider: string }) => string
  'notice.approval': (params: { outcome: string }) => string
  'notice.connectionUnavailable': (params: { reason: string }) => string

  'error.unknownCommand': (params: { command: string }) => string
  'error.unknownProvider': (params: { provider: string }) => string
  'error.modelUsage': string
  'error.thinkingUnavailable': string
  'error.thinkingUnknown': (params: { level: string; levels: string }) => string
  'error.noProvider': string
  'error.languageUnsupported': (params: { value: string }) => string
  'error.pluginRender': (params: { plugin: string; id: string; reason: string }) => string
  'error.pluginLoad': (params: { plugin: string; reason: string }) => string
  'error.apiKeyRequired': string
  'error.providerNotConfigurable': (params: { provider: string }) => string
  'error.providerSignIn': (params: { provider: string }) => string
  'error.connectionTimeout': string

  'pane.unavailable': (params: { pane: string; reason: string }) => string
  'pane.terminal': string
  'pane.editor': string
  'pane.noPty': string
  'pane.notDirectory': (params: { path: string }) => string
  'pane.tooNarrow': (params: { columns: number }) => string

  'update.installing': string
  'update.cannotSelf': string
  'update.available': (params: { current: string; latest: string }) => string
  'update.downloaded': (params: { version: string }) => string
  'update.entryMissing': string
  'update.installed': string
  'update.exitCode': (params: { code: number }) => string

  'input.pressAgain': string
  'input.keepColumn': string

  'plain.summary': string
  'plain.approval': (params: { tool: string }) => string
  'plain.approvalHint': string
  'plain.session': (params: { id: string }) => string
  'plain.turnFailed': string
  'plain.turnCancelled': string
  'plain.sessionError': string
  'plain.unknownCommand': (params: { command: string }) => string
  'plain.questionPrompt': string

  'reasoning.summary': string
  'reasoning.full': string
  'reasoning.hidden': string
}

/** Every key a caller may pass to `t()`. */
export type MessageKey = keyof MessageTable

/** The parameters one key takes, or an empty tuple for a plain string. */
export type MessageParameters<K extends MessageKey> =
  MessageTable[K] extends (...args: infer A) => string ? A : []
