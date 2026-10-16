const WORD_TOKEN_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’._-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;

/**
 * Counts East Asian characters individually and all other letter/number runs
 * as words. Markdown punctuation and whitespace do not contribute to the total.
 */
export function countMarkdownWords(content: string): number {
  return content.match(WORD_TOKEN_PATTERN)?.length ?? 0;
}
