import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ConversationAssistantBlock,
  ConversationContent,
  ConversationItem,
  ConversationSession,
  ConversationSnapshot,
  PendingInteraction,
} from '@hulala/workbench-contracts';
import {
  answerConversationInteraction,
  copyConversationSessionPath,
  loadConversationHistory,
} from '../../services/conversationService';
import { getConversationStore, useConversationStore } from '../../store/conversationStore';
import { useToastStore } from '../../store/toastStore';
import { AgentSparkIcon, CheckTinyIcon, CopyCheckIcon, CopyIcon, ChevronRightIcon, HulalaLogo, SidebarPanelToggleIcon, UserIcon } from '../Icons';
import {
  OP_SG_CAPSULE,
  OP_SG_ON_EDITOR,
} from '../staticGlassCapsule';
import { buildActivityTimeline } from './activityTimeline';
import { ConversationMarkdown } from './ConversationMarkdown';
import { ConversationImage } from './ConversationImage';
import { ConversationMessageBoundary } from './ConversationMessageBoundary';

const DEFAULT_PANEL_HEIGHT = 400;
const MIN_PANEL_WIDTH = 320;
const MIN_PANEL_HEIGHT = 80;
const EDGE_GAP = 12;
const HEADER_CLEARANCE = 45;
const ACTIVITY_MESSAGE_COLLAPSE_LINES = 99;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sessionForId(sessions: ConversationSession[], sessionId: string | null): ConversationSession | null {
  return sessionId ? sessions.find((session) => session.sessionId === sessionId) ?? null : null;
}

function textFromContent(content: ConversationContent[]): string {
  return content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n');
}

function textFromAssistantBlocks(blocks: ConversationAssistantBlock[]): string {
  return blocks.flatMap((block) => block?.type === 'text' ? [block.text] : []).join('\n');
}

function usageMetric(snapshot: ConversationSnapshot | undefined): string {
  const usage = asRecord(snapshot?.projections.values.tokenUsage);
  if (!usage) return '';
  const total = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
    .reduce((sum, key) => sum + (typeof usage[key] === 'number' ? usage[key] as number : 0), 0);
  return total > 0 ? `${total.toLocaleString()} tokens` : '';
}

function status(session: ConversationSession | null, interaction: PendingInteraction | null, error: string | null): {
  label: string;
  tone: 'done' | 'running' | 'error' | 'waiting';
} {
  if (error) return { label: 'Error', tone: 'error' };
  if (interaction?.kind === 'approval') return { label: 'Approval', tone: 'waiting' };
  if (interaction?.kind === 'question') return {
    label: interaction.questions[0]?.intent?.kind === 'plan-review' ? 'Plan review' : 'Question',
    tone: 'waiting',
  };
  return session?.running ? { label: 'Working', tone: 'running' } : { label: 'Done', tone: 'done' };
}

function activityPreview(item: ConversationItem | undefined): string {
  if (!item) return '';
  if (item.kind === 'message') return textFromContent(item.content).replace(/\s+/g, ' ').trim();
  if (item.kind === 'assistant') {
    return textFromAssistantBlocks(item.blocks).replace(/\s+/g, ' ').trim()
      || (item.status === 'running' ? 'Thinking…' : 'Thought');
  }
  if (item.kind === 'tool') return `${item.name} · ${item.status}`;
  return item.label;
}

function Avatar({ role }: { role: 'user' | 'assistant' | 'system' }) {
  if (role === 'assistant') return <span className="hulala-activity-avatar is-assistant"><HulalaLogo className="h-[18px] w-[18px]" /></span>;
  if (role === 'user') return <span className="hulala-activity-avatar is-user" aria-label="You"><UserIcon className="h-[17px] w-[17px]" /></span>;
  return <span className="hulala-activity-avatar is-system">•</span>;
}

function SessionMetadataRow({ tabId, sessionId }: { tabId: string; sessionId: string }) {
  const pushToast = useToastStore((state) => state.pushToast);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied'>('idle');
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  const copyPath = async () => {
    if (copyState === 'copying') return;
    setCopyState('copying');
    try {
      await copyConversationSessionPath(tabId, sessionId);
      setCopyState('copied');
      pushToast('Session path copied');
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => setCopyState('idle'), 1800);
    } catch (reason) {
      setCopyState('idle');
      pushToast(`Could not copy session path: ${messageFor(reason)}`);
    }
  };

  return (
    <div className="hulala-activity-session-meta">
      <span className="hulala-activity-session-label">Session ID</span>
      <code className="hulala-activity-session-id" title={sessionId}>{sessionId}</code>
      <button
        type="button"
        className={`hulala-activity-session-copy${copyState === 'copied' ? ' is-copied' : ''}`}
        title={copyState === 'copied' ? 'Session path copied' : 'Copy session path'}
        aria-label={copyState === 'copied' ? 'Session path copied' : 'Copy session path'}
        disabled={copyState === 'copying'}
        onClick={() => void copyPath()}
      >
        {copyState === 'copied'
          ? <CopyCheckIcon className="h-3.5 w-3.5" />
          : <CopyIcon className="h-3.5 w-3.5" />}
        <span>{copyState === 'copied' ? 'Copied' : 'Copy path'}</span>
      </button>
    </div>
  );
}

function MessageBody({ text, streaming }: { text: string; streaming: boolean }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [canCollapse, setCanCollapse] = useState(false);
  const shouldMeasure = text.length > 1_600 && !expanded;

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !shouldMeasure) {
      setCanCollapse(false);
      return;
    }
    const measure = () => setCanCollapse(body.scrollHeight > body.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [shouldMeasure, text]);

  return (
    <>
      <div
        ref={bodyRef}
        className={`hulala-activity-message-body${shouldMeasure ? ' is-collapse-measure' : ''}${canCollapse && !expanded ? ' is-collapsed' : ''}`}
        style={{ '--hulala-activity-message-collapse-lines': ACTIVITY_MESSAGE_COLLAPSE_LINES } as React.CSSProperties}
      >
        <ConversationMarkdown text={text} streaming={streaming} />
      </div>
      {canCollapse ? <button type="button" className="hulala-activity-message-toggle" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show less' : 'Show more'}</button> : null}
    </>
  );
}

function MessageContents({
  tabId,
  sessionId,
  item,
}: {
  tabId: string;
  sessionId: string;
  item: Extract<ConversationItem, { kind: 'message' }>;
}) {
  const text = textFromContent(item.content);
  const images = item.content.filter((part): part is Extract<ConversationContent, { type: 'image' }> => part.type === 'image');
  return (
    <>
      {text ? <MessageBody text={text} streaming={false} /> : null}
      {images.map((part, index) => (
        <ConversationImage
          key={`${part.attachmentId || part.name || 'image'}:${index}`}
          tabId={tabId}
          sessionId={sessionId}
          part={part}
        />
      ))}
    </>
  );
}

function InternalMessageDisclosure({
  tabId,
  sessionId,
  item,
}: {
  tabId: string;
  sessionId: string;
  item: Extract<ConversationItem, { kind: 'message' }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = item.sourceLabel || (item.role === 'system' ? 'System prompt' : 'Context');
  return (
    <div className="hulala-activity-internal-item">
      <button
        type="button"
        className="hulala-activity-internal-toggle"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronRightIcon className={`h-3.5 w-3.5 ${expanded ? 'rotate-90' : ''}`} />
        <span>{label}</span>
      </button>
      {expanded ? (
        <div className="hulala-activity-message-bubble is-system">
          <MessageContents tabId={tabId} sessionId={sessionId} item={item} />
        </div>
      ) : null}
    </div>
  );
}

function InternalMessageRow({
  tabId,
  sessionId,
  item,
  showAvatar,
}: {
  tabId: string;
  sessionId: string;
  item: Extract<ConversationItem, { kind: 'message' }>;
  showAvatar: boolean;
}) {
  return (
    <div className="hulala-activity-message-row is-system is-internal">
      {showAvatar ? <Avatar role="system" /> : <span className="hulala-activity-avatar-spacer" />}
      <div className="hulala-activity-message-stack">
        <InternalMessageDisclosure tabId={tabId} sessionId={sessionId} item={item} />
      </div>
    </div>
  );
}

function InternalMessageGroup({
  tabId,
  sessionId,
  items,
  showAvatar,
}: {
  tabId: string;
  sessionId: string;
  items: Array<Extract<ConversationItem, { kind: 'message' }>>;
  showAvatar: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = `Context · ${items.length} items`;
  return (
    <div className="hulala-activity-message-row is-system is-internal-group">
      {showAvatar ? <Avatar role="system" /> : <span className="hulala-activity-avatar-spacer" />}
      <div className="hulala-activity-message-stack">
        <button
          type="button"
          className="hulala-activity-internal-toggle is-group"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${items.length} internal messages`}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRightIcon className={`h-3.5 w-3.5 ${expanded ? 'rotate-90' : ''}`} />
          <span>{label}</span>
        </button>
        {expanded ? (
          <div className="hulala-activity-internal-items">
            {items.map((item) => (
              <InternalMessageDisclosure
                key={item.id}
                tabId={tabId}
                sessionId={sessionId}
                item={item}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MessageRow({
  tabId,
  sessionId,
  item,
  showAvatar,
}: {
  tabId: string;
  sessionId: string;
  item: Extract<ConversationItem, { kind: 'message' }>;
  showAvatar: boolean;
}) {
  const role = item.role === 'user' ? 'user' : 'system';
  if (role === 'system') {
    return <InternalMessageRow tabId={tabId} sessionId={sessionId} item={item} showAvatar={showAvatar} />;
  }
  return (
    <div className={`hulala-activity-message-row is-${role}`}>
      {showAvatar ? <Avatar role={role} /> : <span className="hulala-activity-avatar-spacer" />}
      <div className="hulala-activity-message-stack">
        {showAvatar ? <div className="hulala-activity-message-meta">You</div> : null}
        <div className={`hulala-activity-message-bubble is-${role}`}>
          <MessageContents tabId={tabId} sessionId={sessionId} item={item} />
        </div>
      </div>
    </div>
  );
}

function AssistantDisclosure({
  label,
  detail,
}: {
  label: string;
  detail: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="hulala-activity-internal-item">
      <button
        type="button"
        className="hulala-activity-step"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronRightIcon className={`h-3.5 w-3.5 ${expanded ? 'rotate-90' : ''}`} />
        <span>{label}</span>
      </button>
      {expanded && detail ? <pre className="hulala-activity-step-detail">{detail}</pre> : null}
    </div>
  );
}

function AssistantRow({
  tabId,
  sessionId,
  item,
  showAvatar,
}: {
  tabId: string;
  sessionId: string;
  item: Extract<ConversationItem, { kind: 'assistant' }>;
  showAvatar: boolean;
}) {
  return (
    <div className="hulala-activity-message-row is-assistant">
      {showAvatar ? <Avatar role="assistant" /> : <span className="hulala-activity-avatar-spacer" />}
      <div className="hulala-activity-message-stack">
        {showAvatar ? <div className="hulala-activity-message-meta">Hulala</div> : null}
        {item.blocks.map((block, index) => {
          // An already-open window can still hold sparse blocks from an older
          // stream reducer until its next update or history refresh.
          if (!block) return null;
          if (block.type === 'reasoning') {
            if (!block.text.trim()) return null;
            return (
              <AssistantDisclosure
                key={`reasoning:${index}`}
                label={item.status === 'running' ? 'Thinking…' : 'Thought'}
                detail={block.text}
              />
            );
          }
          if (block.type === 'text') {
            if (!block.text) return null;
            return (
              <div key={`text:${index}`} className={`hulala-activity-message-bubble is-assistant${item.status === 'running' ? ' is-streaming' : ''}`}>
                <MessageBody text={block.text} streaming={item.status === 'running'} />
              </div>
            );
          }
          if (block.type === 'image') {
            return (
              <div key={`image:${index}`} className="hulala-activity-message-bubble is-assistant">
                <ConversationImage tabId={tabId} sessionId={sessionId} part={block} />
              </div>
            );
          }
          if (block.type === 'unknown') {
            return (
              <AssistantDisclosure
                key={`unknown:${index}`}
                label="Unsupported content"
                detail={JSON.stringify(block.value, null, 2)}
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function ActivityStep({ item, showAvatar }: { item: Exclude<ConversationItem, { kind: 'message' } | { kind: 'assistant' }>; showAvatar: boolean }) {
  const [expanded, setExpanded] = useState(item.kind === 'tool' && item.status === 'running');
  const label = item.kind === 'tool' ? `${item.name} · ${item.status}` : item.label;
  const detail = item.kind === 'tool' ? [item.argumentsText, item.resultText].filter(Boolean).join('\n\n') : item.detail;
  return (
    <div className="hulala-activity-message-row is-step">
      {showAvatar ? <Avatar role="assistant" /> : <span className="hulala-activity-avatar-spacer" />}
      <div className="hulala-activity-message-stack">
        <button type="button" className="hulala-activity-step" onClick={() => setExpanded((value) => !value)}>
          <ChevronRightIcon className={`h-3.5 w-3.5 ${expanded ? 'rotate-90' : ''}`} />
          <span>{label}</span>
        </button>
        {expanded && detail ? <pre className="hulala-activity-step-detail">{detail}</pre> : null}
      </div>
    </div>
  );
}

function TodoStrip({ value }: { value: unknown }) {
  const record = asRecord(value);
  const todos = Array.isArray(value) ? value : Array.isArray(record?.todos) ? record.todos : [];
  if (todos.length === 0) return null;
  return (
    <details className="hulala-activity-todos">
      <summary>Plan · {todos.length} items</summary>
      {todos.map((entry, index) => {
        const todo = asRecord(entry);
        return <div key={String(todo?.id || index)} className={`is-${String(todo?.status || 'pending')}`}>{String(todo?.content || todo?.text || '')}</div>;
      })}
    </details>
  );
}

function ApprovalCard({ tabId, interaction }: { tabId: string; interaction: Extract<PendingInteraction, { kind: 'approval' }> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = (outcome: 'allowed-once' | 'rejected') => {
    setBusy(true);
    setError('');
    void answerConversationInteraction(tabId, interaction.interactionId, { kind: 'approval', outcome })
      .catch((reason) => {
        setBusy(false);
        setError(messageFor(reason));
      });
  };
  return (
    <InteractionRow>
      <section className="hulala-activity-request-card is-approval" aria-label="Approval required">
        <header className="hulala-activity-request-header">
          <span className="hulala-activity-request-pulse" />
          <span>Needs your approval</span>
          <code>{interaction.toolName}</code>
        </header>
        <div className="hulala-activity-request-content">
          <strong>{interaction.reason || `${interaction.toolName} requests privileged execution`}</strong>
          <p>Choose whether Hulala may run this action once.</p>
        </div>
        {error ? <div className="hulala-activity-request-error" role="alert">{error}</div> : null}
        <footer className="hulala-activity-request-actions">
          <button type="button" className="ui-pill-btn-secondary" disabled={busy} onClick={() => submit('rejected')}>Reject</button>
          <button type="button" className="ui-pill-btn-primary" disabled={busy} onClick={() => submit('allowed-once')}>{busy ? 'Submitting…' : 'Allow once'}</button>
        </footer>
      </section>
    </InteractionRow>
  );
}

function InteractionRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="hulala-activity-message-row is-request">
      <span className="hulala-activity-avatar-spacer" />
      <div className="hulala-activity-message-stack is-request">{children}</div>
    </div>
  );
}

function QuestionCard({ tabId, interaction }: { tabId: string; interaction: Extract<PendingInteraction, { kind: 'question' }> }) {
  const [answers, setAnswers] = useState<Record<string, { selected: string[]; custom?: string }>>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const question = interaction.questions[index];
  if (!question) return null;
  const draft = answers[question.id] ?? { selected: [] };
  const planReview = question.intent?.kind === 'plan-review';
  const hasDraftAnswer = draft.selected.length > 0 || Boolean(draft.custom?.trim());
  const allAnswered = interaction.questions.every((entry) => {
    const answer = answers[entry.id];
    return Boolean(answer?.selected.length || answer?.custom?.trim());
  });
  const update = (next: { selected: string[]; custom?: string }) => setAnswers((current) => ({ ...current, [question.id]: next }));
  const submit = () => {
    setBusy(true);
    setError('');
    void answerConversationInteraction(tabId, interaction.interactionId, {
      kind: 'question',
      answer: { answers: interaction.questions.map((entry) => ({
        id: entry.id,
        selected: answers[entry.id]?.selected ?? [],
        ...(answers[entry.id]?.custom ? { custom: answers[entry.id]?.custom } : {}),
      })) },
    }).catch((reason) => {
      setBusy(false);
      setError(messageFor(reason));
    });
  };
  return (
    <InteractionRow>
      <section className="hulala-activity-request-card is-question" aria-label={planReview ? 'Plan review' : 'Question from Hulala'}>
        <header className="hulala-activity-request-header">
          <span className="hulala-activity-request-pulse" />
          <span>{planReview ? 'Review requested' : 'Hulala needs your input'}</span>
          {interaction.questions.length > 1 ? <span className="hulala-activity-request-progress">{index + 1} / {interaction.questions.length}</span> : null}
        </header>
        <div className="hulala-activity-request-content">
          {question.header ? <span className="hulala-activity-request-kicker">{question.header}</span> : null}
          <strong>{question.question}</strong>
          {question.detail ? <ConversationMarkdown text={question.detail} /> : null}
          <div className="hulala-activity-question-options" role={question.multiSelect ? 'group' : 'radiogroup'} aria-label={question.question}>
            {(question.options || []).map((option) => {
              const selected = draft.selected.includes(option.label);
              return (
                <button
                  type="button"
                  key={option.label}
                  className={selected ? 'is-selected' : ''}
                  role={question.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={selected}
                  onClick={() => update({
                    selected: question.multiSelect
                      ? selected ? draft.selected.filter((label) => label !== option.label) : [...draft.selected, option.label]
                      : [option.label],
                    ...(question.multiSelect && draft.custom ? { custom: draft.custom } : {}),
                  })}
                >
                  <span className="hulala-activity-option-indicator">{selected ? <CheckTinyIcon /> : null}</span>
                  <span className="hulala-activity-option-copy">
                    <strong>{option.label}</strong>
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                </button>
              );
            })}
            {!planReview ? (
              <label className="hulala-activity-custom-answer">
                <span>Or type your own answer</span>
                <textarea
                  aria-label="Custom answer"
                  value={draft.custom || ''}
                  onChange={(event) => update({ selected: question.multiSelect ? draft.selected : [], custom: event.target.value })}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && allAnswered && !busy) submit();
                  }}
                  placeholder="Add context or enter another choice…"
                />
              </label>
            ) : null}
          </div>
        </div>
        {error ? <div className="hulala-activity-request-error" role="alert">{error}</div> : null}
        <footer className="hulala-activity-request-actions is-between">
          <button type="button" className="ui-pill-btn-secondary" disabled={busy} onClick={() => {
            setBusy(true);
            setError('');
            void answerConversationInteraction(tabId, interaction.interactionId, { kind: 'cancel' }).catch((reason) => {
              setBusy(false);
              setError(messageFor(reason));
            });
          }}>{planReview ? 'Discuss instead' : 'Cancel'}</button>
          <div>
            {index > 0 ? <button type="button" className="ui-pill-btn-secondary" disabled={busy} onClick={() => setIndex((value) => value - 1)}>Back</button> : null}
            {index < interaction.questions.length - 1
              ? <button type="button" className="ui-pill-btn-primary" disabled={busy || !hasDraftAnswer} onClick={() => setIndex((value) => value + 1)}>Continue</button>
              : <button type="button" className="ui-pill-btn-primary" disabled={busy || !allAnswered} onClick={submit}>{busy ? 'Submitting…' : planReview ? 'Submit review' : 'Submit answer'}</button>}
          </div>
        </footer>
      </section>
    </InteractionRow>
  );
}

export function ActivityPanel({
  tabId,
  docked = false,
  onPinToRight,
}: {
  tabId: string;
  docked?: boolean;
  onPinToRight?: () => void;
}) {
  const activeSessionId = useConversationStore(tabId, (state) => state.activeSessionId);
  const sessions = useConversationStore(tabId, (state) => state.sessions);
  const snapshots = useConversationStore(tabId, (state) => state.snapshots);
  const panels = useConversationStore(tabId, (state) => state.activityPanels);
  const error = useConversationStore(tabId, (state) => state.error);
  const historicalSessionIds = useConversationStore(tabId, (state) => state.historicalSessionIds);
  const store = useMemo(() => getConversationStore(tabId), [tabId]);
  const session = sessionForId(sessions, activeSessionId);
  const snapshot = activeSessionId ? snapshots[activeSessionId] : undefined;
  const interaction = snapshot?.pendingInteractions[0] ?? null;
  const panelState = activeSessionId ? panels[activeSessionId] : undefined;
  const expanded = panelState?.expanded ?? false;
  const panelExpanded = docked || expanded;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const olderScrollRef = useRef<{ top: number; height: number } | null>(null);
  const followingTailRef = useRef(true);
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [panelLeft, setPanelLeft] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [resizeEdge, setResizeEdge] = useState<'left' | 'right' | null>(null);

  const hasContent = Boolean(
    (snapshot?.items.length || 0) > 0
    || session?.running
    || interaction
    || error
    || snapshot?.projections.values.todos
    || snapshot?.projections.values.plan,
  );
  const visible = Boolean(session && !session.blank && hasContent);
  const statusView = status(session, interaction, error);
  const queueCount = snapshot?.queue.length || 0;
  const latestPreview = activityPreview(snapshot?.items.at(-1));
  const width = Math.max(MIN_PANEL_WIDTH, Math.min(hostSize.width - EDGE_GAP * 2, panelWidth ?? Math.round(hostSize.width * 0.85)));
  const height = Math.max(MIN_PANEL_HEIGHT, Math.min(panelHeight, Math.max(MIN_PANEL_HEIGHT, hostSize.height - EDGE_GAP * 2)));
  const left = Math.max(EDGE_GAP, Math.min(hostSize.width - width - EDGE_GAP, panelLeft ?? Math.round((hostSize.width - width) / 2)));

  useEffect(() => {
    let active = true;
    void window.hulala?.settings.get().then((settings) => {
      if (!active) return;
      const ui = asRecord(settings?.ui);
      if (typeof ui?.activityPanelWidth === 'number') setPanelWidth(ui.activityPanelWidth);
      if (typeof ui?.activityPanelMaxHeight === 'number') setPanelHeight(ui.activityPanelMaxHeight);
    });
    return () => { active = false; };
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setHostSize({ width: host.clientWidth, height: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const parent = hostRef.current?.parentElement;
    const panel = panelRef.current;
    if (!parent) return;
    const setSafeArea = () => {
      const covered = !docked && visible && !expanded && panel ? panel.getBoundingClientRect().height + EDGE_GAP : 0;
      parent.style.setProperty('--op-editor-bottom-safe-area', `${covered ? Math.ceil(covered + HEADER_CLEARANCE) : 0}px`);
    };
    setSafeArea();
    const observer = panel ? new ResizeObserver(setSafeArea) : null;
    if (panel) observer?.observe(panel);
    return () => {
      observer?.disconnect();
      parent.style.setProperty('--op-editor-bottom-safe-area', '0px');
    };
  }, [docked, expanded, visible]);

  useEffect(() => {
    if (interaction && activeSessionId) store.getState().setActivityExpanded(activeSessionId, true);
  }, [activeSessionId, interaction?.interactionId, store]);

  useLayoutEffect(() => {
    followingTailRef.current = true;
    olderScrollRef.current = null;
    const body = bodyRef.current;
    if (body && panelExpanded) body.scrollTop = body.scrollHeight;
  }, [activeSessionId]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !panelExpanded || olderScrollRef.current || !followingTailRef.current) return;
    body.scrollTop = body.scrollHeight;
  }, [panelExpanded, snapshot?.items.length, snapshot?.lastSeq]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const column = columnRef.current;
    if (!body || !column || !panelExpanded) return;
    const observer = new ResizeObserver(() => {
      if (followingTailRef.current && !olderScrollRef.current) body.scrollTop = body.scrollHeight;
    });
    observer.observe(column);
    return () => observer.disconnect();
  }, [panelExpanded]);

  useLayoutEffect(() => {
    const pending = olderScrollRef.current;
    const body = bodyRef.current;
    if (!pending || !body) return;
    body.scrollTop = pending.top + (body.scrollHeight - pending.height);
    olderScrollRef.current = null;
  }, [snapshot?.firstSeq, snapshot?.items.length]);

  const persist = (patch: Record<string, number>) => {
    void window.hulala?.settings.set({ ui: patch }).catch(() => undefined);
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (docked) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const host = hostRef.current?.getBoundingClientRect();
    if (!host) return;
    const initialLeft = left;
    const startX = event.clientX;
    let moved = false;
    setDragging(true);
    const move = (next: PointerEvent) => {
      if (Math.abs(next.clientX - startX) > 4) moved = true;
      setPanelLeft(Math.max(EDGE_GAP, Math.min(host.width - width - EDGE_GAP, initialLeft + next.clientX - startX)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      setDragging(false);
      if (!moved && activeSessionId) store.getState().setActivityExpanded(activeSessionId, !expanded, { userAction: true });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const startResize = (edge: 'left' | 'right', event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const host = hostRef.current?.getBoundingClientRect();
    if (!host) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = width;
    const startHeight = height;
    const startLeft = left;
    let finalWidth = startWidth;
    let finalHeight = startHeight;
    let finalLeft = startLeft;
    setResizeEdge(edge);
    const move = (next: PointerEvent) => {
      const deltaX = next.clientX - startX;
      finalHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(host.height - EDGE_GAP * 2, startHeight - (next.clientY - startY)));
      if (edge === 'right') {
        finalWidth = Math.max(MIN_PANEL_WIDTH, Math.min(host.width - startLeft - EDGE_GAP, startWidth + deltaX));
      } else {
        finalWidth = Math.max(MIN_PANEL_WIDTH, Math.min(host.width - EDGE_GAP, startWidth - deltaX));
        finalLeft = Math.max(EDGE_GAP, Math.min(host.width - finalWidth - EDGE_GAP, startLeft + startWidth - finalWidth));
        setPanelLeft(finalLeft);
      }
      setPanelWidth(finalWidth);
      setPanelHeight(finalHeight);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      setResizeEdge(null);
      setPanelLeft(finalLeft);
      persist({ activityPanelWidth: Math.round(finalWidth), activityPanelMaxHeight: Math.round(finalHeight) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const loadOlder = async () => {
    if (!activeSessionId || snapshot?.firstSeq == null) return;
    const body = bodyRef.current;
    if (body) olderScrollRef.current = { top: body.scrollTop, height: body.scrollHeight };
    store.getState().setLoadingOlder(true);
    try {
      store.getState().prependHistory(await loadConversationHistory(tabId, activeSessionId, snapshot.firstSeq, 200));
    } catch (reason) {
      store.getState().setLoadingOlder(false);
      store.getState().setError(messageFor(reason));
    }
  };

  const jumpLatest = () => {
    if (!activeSessionId) return;
    void loadConversationHistory(tabId, activeSessionId, undefined, 400)
      .then((next) => store.getState().applyOpen({ sessionId: activeSessionId, sessions: store.getState().sessions, snapshot: next }))
      .catch((reason) => store.getState().setError(messageFor(reason)));
  };

  const timeline = useMemo(() => buildActivityTimeline(snapshot?.items || []), [snapshot?.items]);

  return (
    <div ref={hostRef} className={`hulala-activity-layer${docked ? ' is-docked' : ''}`} aria-live="polite">
      {visible ? (
        <div className={`hulala-activity-host${docked ? ' is-docked' : ''}${panelExpanded ? ' is-expanded' : ' is-collapsed'}`} style={docked ? undefined : { left, width }}>
          <section ref={panelRef} className={`hulala-activity-panel ${panelExpanded ? 'is-expanded' : 'is-collapsed'}`}>
            {panelExpanded && !docked ? (
              <>
                <div className={`hulala-activity-corner is-left ${resizeEdge === 'left' ? 'is-active' : ''}`} onPointerDown={(event) => startResize('left', event)} />
                <div className={`hulala-activity-corner is-right ${resizeEdge === 'right' ? 'is-active' : ''}`} onPointerDown={(event) => startResize('right', event)} />
              </>
            ) : null}
            <div className={`${OP_SG_CAPSULE} ${OP_SG_ON_EDITOR} hulala-activity-header ${dragging ? 'is-dragging' : ''}`} onPointerDown={startDrag}>
              {!docked ? (
                <button
                  type="button"
                  className="hulala-activity-chevron"
                  aria-label={expanded ? 'Collapse activity panel' : 'Expand activity panel'}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => activeSessionId && store.getState().setActivityExpanded(activeSessionId, !expanded, { userAction: true })}
                >
                  <ChevronRightIcon className={`h-4 w-4 ${expanded ? 'rotate-90' : ''}`} />
                </button>
              ) : null}
              <span className={`hulala-activity-status is-${statusView.tone}`}>{statusView.label}</span>
              {latestPreview && !panelExpanded ? <span className="hulala-activity-preview">{latestPreview}</span> : null}
              {session?.running && !latestPreview ? <span className="hulala-activity-preview is-cooking"><AgentSparkIcon className="h-4 w-4" /></span> : null}
              <span className="hulala-activity-header-spacer" />
              {queueCount > 0 ? <span className="hulala-activity-hint">{queueCount} queued</span> : null}
              {usageMetric(snapshot) ? <span className="hulala-activity-metric">{usageMetric(snapshot)}</span> : null}
            </div>
            {panelExpanded && !docked && onPinToRight ? (
              <button
                type="button"
                className="hulala-activity-chevron hulala-activity-body-action"
                title="Move Activity to right pane"
                aria-label="Move Activity to right pane"
                onClick={onPinToRight}
              >
                <SidebarPanelToggleIcon className="h-4 w-4 rotate-180" />
              </button>
            ) : null}
            {panelExpanded ? (
              <div
                ref={bodyRef}
                className="hulala-activity-body"
                style={docked ? undefined : { height }}
                onScroll={(event) => {
                  const body = event.currentTarget;
                  followingTailRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
                }}
              >
                <div ref={columnRef} className="hulala-activity-column">
                  {activeSessionId ? <SessionMetadataRow key={activeSessionId} tabId={tabId} sessionId={activeSessionId} /> : null}
                  {snapshot?.hasMore ? <button type="button" className="hulala-activity-window-control" onClick={() => void loadOlder()}>Load earlier</button> : null}
                  <TodoStrip value={snapshot?.projections.values.todos ?? snapshot?.projections.values.todo} />
                  {error ? <div className="hulala-activity-error">{error}</div> : null}
                  {timeline.map((entry) => {
                    if (entry.kind === 'internal-group') {
                      return (
                        <ConversationMessageBoundary key={`${tabId}:${activeSessionId}:${entry.id}`}>
                          <InternalMessageGroup
                            tabId={tabId}
                            sessionId={session?.sessionId || ''}
                            items={entry.items}
                            showAvatar={entry.showAvatar}
                          />
                        </ConversationMessageBoundary>
                      );
                    }
                    if (entry.item.kind === 'message') {
                      return <ConversationMessageBoundary key={`${tabId}:${activeSessionId}:${entry.item.id}`}><MessageRow tabId={tabId} sessionId={session?.sessionId || ''} item={entry.item} showAvatar={entry.showAvatar} /></ConversationMessageBoundary>;
                    }
                    if (entry.item.kind === 'assistant') {
                      return <ConversationMessageBoundary key={`${tabId}:${activeSessionId}:${entry.item.id}`}><AssistantRow tabId={tabId} sessionId={session?.sessionId || ''} item={entry.item} showAvatar={entry.showAvatar} /></ConversationMessageBoundary>;
                    }
                    return <ConversationMessageBoundary key={`${tabId}:${activeSessionId}:${entry.item.id}`}><ActivityStep item={entry.item} showAvatar={entry.showAvatar} /></ConversationMessageBoundary>;
                  })}
                  {interaction?.kind === 'approval' ? <ApprovalCard key={interaction.interactionId} tabId={tabId} interaction={interaction} /> : null}
                  {interaction?.kind === 'question' ? <QuestionCard key={interaction.interactionId} tabId={tabId} interaction={interaction} /> : null}
                  {activeSessionId && historicalSessionIds.includes(activeSessionId)
                    ? <button type="button" className="hulala-activity-window-control" onClick={jumpLatest}>Jump to latest</button>
                    : null}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
