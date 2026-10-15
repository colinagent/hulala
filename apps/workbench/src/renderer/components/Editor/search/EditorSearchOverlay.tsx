import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import {
  CaseSensitiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseButton,
  RegexIcon,
  ReplaceIcon,
  WholeWordIcon,
} from '../../Icons';
import {
  applySearchState,
  closeEditorSearch,
  countMatches,
  editorSearchCommands,
  EMPTY_EDITOR_SEARCH_STATE,
  type EditorSearchFlags,
  type EditorSearchState,
} from './editorSearchController';
import {
  OP_SG_CAPSULE,
  OP_SG_ON_OVERLAY,
  UI_PILL_BTN_COMPACT,
  UI_PILL_BTN_PRIMARY,
  UI_PILL_BTN_SECONDARY,
} from '../../staticGlassCapsule';

export type EditorSearchOverlayHandle = {
  open: (options?: { replace?: boolean; preset?: string }) => void;
  close: () => void;
  isOpen: () => boolean;
};

type Props = {
  /** 拿到 EditorView 的回调（视图随 tab 切换会重建，所以要懒取） */
  getView: () => EditorView | null;
  /** 受控 ref：父组件用来响应 ⌘F / ⌘⌥F */
  registerHandle?: (handle: EditorSearchOverlayHandle | null) => void;
  /** 是否允许替换（只读编辑器关闭） */
  enableReplace?: boolean;
};

const ARROW_BTN_CLASS = 'h-7 w-7 rounded text-secondary-text hover:bg-hover-bg hover:text-prime-text inline-flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-secondary-text';

const TOGGLE_BTN_CLASS_BASE = 'h-7 w-7 rounded inline-flex items-center justify-center transition-colors';
const TOGGLE_BTN_OFF = 'text-secondary-text hover:bg-hover-bg hover:text-prime-text';
const TOGGLE_BTN_ON = 'bg-search-match-bg text-search-match-text';

function getSelectedSearchText(view: EditorView | null): string {
  if (!view) return '';
  const selection = view.state.selection.main;
  if (selection.empty) return '';
  const selected = view.state.doc.sliceString(selection.from, selection.to).trim();
  // 搜索框只带入短单行选择,避免误把大段内容塞进去。
  if (!selected || selected.length > 160 || /[\r\n]/.test(selected)) return '';
  return selected;
}

export const EditorSearchOverlay: React.FC<Props> = ({
  getView,
  registerHandle,
  enableReplace = true,
}) => {
  const [open, setOpen] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);
  const [search, setSearch] = useState('');
  const [replace, setReplace] = useState('');
  const [flags, setFlags] = useState<EditorSearchFlags>(EMPTY_EDITOR_SEARCH_STATE.flags);
  const [matchInfo, setMatchInfo] = useState<{ total: number; current: number; truncated: boolean }>(
    { total: 0, current: 0, truncated: false },
  );

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef(open);
  const lastSearchSpecRef = useRef('');

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // 暴露 handle 给父组件
  useEffect(() => {
    if (!registerHandle) return;
    const handle: EditorSearchOverlayHandle = {
      open: (options) => {
        const wantReplace = !!options?.replace && enableReplace;
        setOpen(true);
        if (wantReplace) setReplaceMode(true);
        const preset = typeof options?.preset === 'string' && options.preset.length > 0
          ? options.preset
          : getSelectedSearchText(getView());
        if (preset) {
          setSearch(preset);
        }
        // 下一帧聚焦,等输入框 mount
        requestAnimationFrame(() => {
          if (wantReplace) {
            replaceInputRef.current?.focus();
            replaceInputRef.current?.select();
          } else {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
          }
        });
      },
      close: () => {
        setOpen(false);
        const view = getView();
        if (view) {
          // 清掉高亮,关闭隐藏 CM search panel,并把焦点还给编辑器
          closeEditorSearch(view);
          view.focus();
        }
      },
      isOpen: () => openRef.current,
    };
    registerHandle(handle);
    return () => registerHandle(null);
    // 这里 open 不能进依赖,否则每次 setOpen 都会重新注册;让父用 isOpen() 调用而不是缓存值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerHandle, enableReplace, getView]);

  // 同步搜索状态到 CodeMirror,更新匹配数
  useEffect(() => {
    if (!open) return;
    const view = getView();
    if (!view) return;
    const state: EditorSearchState = {
      search,
      replace,
      flags,
    };
    applySearchState(view, state);
    if (search.length === 0) {
      lastSearchSpecRef.current = '';
      setMatchInfo({ total: 0, current: 0, truncated: false });
      return;
    }

    const searchSpec = JSON.stringify({ search, flags });
    const infoBeforeJump = countMatches(view, state);
    if (infoBeforeJump.valid && infoBeforeJump.total > 0 && lastSearchSpecRef.current !== searchSpec) {
      editorSearchCommands.next(view);
      lastSearchSpecRef.current = searchSpec;
      requestAnimationFrame(() => {
        const infoAfterJump = countMatches(view, state);
        setMatchInfo({
          total: infoAfterJump.total,
          current: infoAfterJump.current,
          truncated: infoAfterJump.truncated,
        });
      });
      return;
    }
    setMatchInfo({
      total: infoBeforeJump.total,
      current: infoBeforeJump.current,
      truncated: infoBeforeJump.truncated,
    });
  }, [open, search, replace, flags, getView]);

  // 编辑器选区变化时重新计算 current(用 selection set 监听比较侵入,这里用 polling-like requestAnimationFrame on jump)
  // 简化:在 next/prev 触发后由我们手动重算

  const refreshMatchInfo = useCallback(() => {
    const view = getView();
    if (!view) return;
    if (search.length === 0) {
      setMatchInfo({ total: 0, current: 0, truncated: false });
      return;
    }
    const info = countMatches(view, { search, replace, flags });
    setMatchInfo({ total: info.total, current: info.current, truncated: info.truncated });
  }, [getView, search, replace, flags]);

  const handleNext = useCallback(() => {
    const view = getView();
    if (!view) return;
    if (search.length === 0) return;
    editorSearchCommands.next(view);
    requestAnimationFrame(refreshMatchInfo);
  }, [getView, refreshMatchInfo, search.length]);

  const handlePrevious = useCallback(() => {
    const view = getView();
    if (!view) return;
    if (search.length === 0) return;
    editorSearchCommands.previous(view);
    requestAnimationFrame(refreshMatchInfo);
  }, [getView, refreshMatchInfo, search.length]);

  const handleReplaceNext = useCallback(() => {
    const view = getView();
    if (!view || !enableReplace) return;
    editorSearchCommands.replaceNext(view);
    requestAnimationFrame(refreshMatchInfo);
  }, [enableReplace, getView, refreshMatchInfo]);

  const handleReplaceAll = useCallback(() => {
    const view = getView();
    if (!view || !enableReplace) return;
    editorSearchCommands.replaceAll(view);
    requestAnimationFrame(refreshMatchInfo);
  }, [enableReplace, getView, refreshMatchInfo]);

  const handleClose = useCallback(() => {
    setOpen(false);
    const view = getView();
    if (view) {
      closeEditorSearch(view);
      view.focus();
    }
  }, [getView]);

  const toggleFlag = useCallback((key: keyof EditorSearchFlags) => {
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const noMatch = search.length > 0 && matchInfo.total === 0;

  const counterLabel = useMemo(() => {
    if (search.length === 0) return '';
    if (matchInfo.total === 0) return 'No results';
    const cur = matchInfo.current || 1;
    const total = matchInfo.truncated ? `${matchInfo.total}+` : `${matchInfo.total}`;
    return `${cur} / ${total}`;
  }, [matchInfo, search.length]);

  if (!open) return null;

  const inputBaseClass = 'h-7 flex-1 min-w-0 rounded border bg-background px-2 text-[13px] text-prime-text outline-none transition-colors placeholder:text-secondary-text';
  const searchInputClass = `${inputBaseClass} ${noMatch ? 'border-accent' : 'border-border focus:border-brand'}`;
  const replaceInputClass = `${inputBaseClass} border-border focus:border-brand`;

  return (
    <div
      className="absolute right-3 top-3 z-30 flex w-[420px] max-w-[calc(100%-24px)] flex-col gap-1.5 rounded-md border border-border bg-overlay-bg p-2 shadow-lg"
      role="dialog"
      aria-label="Find in editor"
      onMouseDown={(e) => {
        // 阻止 mousedown 冒泡到编辑器(否则 CM 抢焦点)
        e.stopPropagation();
      }}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={ARROW_BTN_CLASS}
          title={replaceMode ? 'Hide replace (⌘⌥F)' : 'Show replace (⌘⌥F)'}
          onClick={() => {
            if (!enableReplace) return;
            setReplaceMode((v) => !v);
          }}
          disabled={!enableReplace}
          aria-label="Toggle replace"
        >
          {replaceMode ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}
        </button>

        <input
          ref={searchInputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) handlePrevious();
              else handleNext();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              handleClose();
            }
          }}
          placeholder="Find"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className={searchInputClass}
        />

        <span
          className={`min-w-[60px] px-1 text-right text-[11px] tabular-nums ${noMatch ? 'text-accent' : 'text-secondary-text'}`}
          aria-live="polite"
        >
          {counterLabel}
        </span>

        <button
          type="button"
          className={ARROW_BTN_CLASS}
          onClick={handlePrevious}
          title="Previous match (⇧↵)"
          disabled={search.length === 0}
        >
          <ChevronDownIcon className="w-3.5 h-3.5 rotate-180" />
        </button>
        <button
          type="button"
          className={ARROW_BTN_CLASS}
          onClick={handleNext}
          title="Next match (↵)"
          disabled={search.length === 0}
        >
          <ChevronDownIcon className="w-3.5 h-3.5" />
        </button>

        <div className="mx-1 h-4 w-px bg-border" />

        <button
          type="button"
          className={`${TOGGLE_BTN_CLASS_BASE} ${flags.caseSensitive ? TOGGLE_BTN_ON : TOGGLE_BTN_OFF}`}
          onClick={() => toggleFlag('caseSensitive')}
          title="Match case"
          aria-pressed={flags.caseSensitive}
        >
          <CaseSensitiveIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className={`${TOGGLE_BTN_CLASS_BASE} ${flags.wholeWord ? TOGGLE_BTN_ON : TOGGLE_BTN_OFF}`}
          onClick={() => toggleFlag('wholeWord')}
          title="Match whole word"
          aria-pressed={flags.wholeWord}
        >
          <WholeWordIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className={`${TOGGLE_BTN_CLASS_BASE} ${flags.regex ? TOGGLE_BTN_ON : TOGGLE_BTN_OFF}`}
          onClick={() => toggleFlag('regex')}
          title="Use regular expression"
          aria-pressed={flags.regex}
        >
          <RegexIcon className="w-3.5 h-3.5" />
        </button>

        <CloseButton variant="inline" onClick={handleClose} title="Close (Esc)" />
      </div>

      {replaceMode && enableReplace ? (
        <div className="flex items-center gap-1 pl-8">
          <input
            ref={replaceInputRef}
            type="text"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) handleReplaceAll();
                else handleReplaceNext();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                handleClose();
              }
            }}
            placeholder="Replace"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className={replaceInputClass}
          />
          <button
            type="button"
            className={`${UI_PILL_BTN_PRIMARY} ${OP_SG_CAPSULE} ${OP_SG_ON_OVERLAY} ${UI_PILL_BTN_COMPACT} disabled:cursor-not-allowed disabled:opacity-50`}
            onClick={handleReplaceNext}
            title="Replace next (↵)"
            disabled={search.length === 0}
          >
            <ReplaceIcon className="w-3.5 h-3.5" />
            <span>Replace</span>
          </button>
          <button
            type="button"
            className={`${UI_PILL_BTN_SECONDARY} ${UI_PILL_BTN_COMPACT} font-medium disabled:cursor-not-allowed disabled:opacity-50`}
            onClick={handleReplaceAll}
            title="Replace all (⇧↵)"
            disabled={search.length === 0}
          >
            All
          </button>
        </div>
      ) : null}
    </div>
  );
};
