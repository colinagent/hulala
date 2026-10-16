/**
 * 编辑器局部搜索控制器:
 *  - 直接复用 @codemirror/search 的状态机和命令,
 *    我们只渲染一个 React 浮层来驱动它(不打开 CM 默认 panel)。
 *  - 提供 setQuery / next / prev / replace / replaceAll / countMatches。
 */

import { EditorView } from '@codemirror/view';
import {
  SearchQuery,
  setSearchQuery,
  openSearchPanel,
  closeSearchPanel,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  selectMatches,
  RegExpCursor,
  SearchCursor,
} from '@codemirror/search';

export type EditorSearchFlags = {
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
};

export type EditorSearchState = {
  search: string;
  replace: string;
  flags: EditorSearchFlags;
};

export const EMPTY_EDITOR_SEARCH_STATE: EditorSearchState = {
  search: '',
  replace: '',
  flags: { caseSensitive: false, regex: false, wholeWord: false },
};

export function buildSearchQuery(state: EditorSearchState): SearchQuery {
  return new SearchQuery({
    search: state.search,
    replace: state.replace,
    caseSensitive: state.flags.caseSensitive,
    regexp: state.flags.regex,
    wholeWord: state.flags.wholeWord,
  });
}

export function applySearchState(view: EditorView, state: EditorSearchState): void {
  // CM6 的 searchHighlighter 只有在 panel=true 时才会创建 .cm-searchMatch。
  // 我们在 editor setup 里把 panel 替换成隐藏 panel,所以这里打开的是"高亮开关",不是默认 UI。
  if (state.search.length > 0) {
    openSearchPanel(view);
  }
  view.dispatch({ effects: setSearchQuery.of(buildSearchQuery(state)) });
}

export function closeEditorSearch(view: EditorView): void {
  closeSearchPanel(view);
  view.dispatch({ effects: setSearchQuery.of(buildSearchQuery(EMPTY_EDITOR_SEARCH_STATE)) });
}

/**
 * 统计当前文档中匹配总数,以及当前光标/选区位置之后第一个匹配的索引(从 1 开始)。
 * 仅在 query 有效时返回 total > 0。无效 / 空查询时返回 {total: 0, current: 0}。
 *
 * 大文档时为避免阻塞 UI,设置一个上限 cap;超过则返回 truncated。
 */
const MATCH_CAP = 5000;

export type MatchCount = {
  total: number;
  current: number;
  truncated: boolean;
  valid: boolean;
};

export function countMatches(view: EditorView, state: EditorSearchState): MatchCount {
  const query = buildSearchQuery(state);
  if (!query.valid) {
    return { total: 0, current: 0, truncated: false, valid: false };
  }
  const doc = view.state.doc;
  const docLength = doc.length;
  if (docLength === 0 || state.search.length === 0) {
    return { total: 0, current: 0, truncated: false, valid: true };
  }

  const cursorAt = view.state.selection.main.from;
  const fullText = doc.sliceString(0);
  let total = 0;
  let current = 0;
  let truncated = false;

  if (state.flags.regex) {
    const cursor = new RegExpCursor(
      doc,
      state.search,
      { ignoreCase: !state.flags.caseSensitive },
      0,
      docLength,
    );
    while (!cursor.next().done) {
      if (state.flags.wholeWord && !isWholeWordMatch(fullText, cursor.value.from, cursor.value.to)) {
        continue;
      }
      total += 1;
      if (current === 0 && cursor.value.from >= cursorAt) {
        current = total;
      }
      if (total >= MATCH_CAP) {
        truncated = true;
        break;
      }
    }
  } else {
    const normalize = state.flags.caseSensitive ? undefined : (s: string) => s.toLowerCase();
    const cursor = new SearchCursor(
      doc,
      state.search,
      0,
      docLength,
      normalize,
    );
    while (!cursor.next().done) {
      const { from, to } = cursor.value;
      if (state.flags.wholeWord && !isWholeWordMatch(fullText, from, to)) {
        continue;
      }
      total += 1;
      if (current === 0 && from >= cursorAt) {
        current = total;
      }
      if (total >= MATCH_CAP) {
        truncated = true;
        break;
      }
    }
  }

  if (total > 0 && current === 0) {
    // 光标已经在最后一个匹配之后:展示最后一个为"当前"。
    current = total;
  }

  return { total, current, truncated, valid: true };
}

function isWordChar(ch: string): boolean {
  return /[\w\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u4e00-\u9fff\u3040-\u30ff]/.test(ch);
}

function isWholeWordMatch(text: string, from: number, to: number): boolean {
  const before = from > 0 ? text.charAt(from - 1) : '';
  const after = to < text.length ? text.charAt(to) : '';
  if (before && isWordChar(before)) return false;
  if (after && isWordChar(after)) return false;
  return true;
}

export const editorSearchCommands = {
  next: findNext,
  previous: findPrevious,
  replaceNext,
  replaceAll,
  selectAll: selectMatches,
};
