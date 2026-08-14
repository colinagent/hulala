"use client";

import type {
  CreateLoopInput,
  HumanDecision,
  HumanPrior,
  LoopAggregate,
  Observation,
  Revision,
} from "@loopwithai/core";
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  CircleGauge,
  Download,
  FlaskConical,
  Gauge,
  HardDrive,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TimerReset,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { QuantLoopPrototype } from "./quant-loop-prototype";

interface AgentStatus {
  reachable: boolean;
  configured: boolean;
  apiUrl: string;
  message: string;
}

type View = "home" | "new" | "loop" | "quant";

const STATUS_LABEL: Record<LoopAggregate["status"], string> = {
  ready: "等待人的判断",
  awaiting_agent: "等待 Agent",
  awaiting_human: "等待人的决定",
  running: "实验运行中",
  reviewing: "等待复盘",
  completed: "本轮已完成",
};

const STEPS = ["人的 Prior", "Agent 建议", "人的决定", "现实证据", "模型修订"];

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed with ${response.status}.`);
  return body;
}

export function LoopWorkbench() {
  const [loops, setLoops] = useState<LoopAggregate[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [view, setView] = useState<View>("home");
  const [agent, setAgent] = useState<AgentStatus>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const selected = useMemo(() => loops.find((loop) => loop.id === selectedId), [loops, selectedId]);

  const load = useCallback(async () => {
    try {
      const [nextLoops, nextAgent] = await Promise.all([
        api<LoopAggregate[]>("/api/loops"),
        api<AgentStatus>("/api/system/agent"),
      ]);
      setLoops(nextLoops);
      setAgent(nextAgent);
      if (selectedId && !nextLoops.some((loop) => loop.id === selectedId)) setSelectedId(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法读取本地 Loop。");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createLoop(input: CreateLoopInput) {
    await run(async () => {
      const created = await api<LoopAggregate>("/api/loops", { method: "POST", body: JSON.stringify(input) });
      setLoops((current) => [created, ...current]);
      setSelectedId(created.id);
      setView("loop");
    });
  }

  async function performAction(payload: unknown) {
    if (!selected) return;
    await run(async () => {
      const updated = await api<LoopAggregate>(`/api/loops/${selected.id}/actions`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setLoops((current) => current.map((loop) => (loop.id === updated.id ? updated : loop)));
    });
  }

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await task();
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "本地操作失败。");
    } finally {
      setBusy(false);
    }
  }

  function openLoop(id: string) {
    setSelectedId(id);
    setView("loop");
    setError(undefined);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("home")} aria-label="返回 Loop 首页">
          <span className="brand-mark"><span /></span>
          <span>Loop</span>
        </button>

        <button className="new-loop-button" onClick={() => setView("new")}>
          <Plus size={17} /> 新建 Loop
        </button>

        <button className={view === "quant" ? "quant-prototype-button active" : "quant-prototype-button"} onClick={() => setView("quant")}>
          <ChartNoAxesCombined size={16} />
          <span><strong>量化 Loop 原型</strong><small>体验一个完整闭环</small></span>
          <ChevronRight size={14} />
        </button>

        <div className="sidebar-label">我的 Loops</div>
        <nav className="loop-nav" aria-label="我的 Loops">
          {loops.map((loop) => (
            <button
              key={loop.id}
              className={selectedId === loop.id && view === "loop" ? "loop-nav-item active" : "loop-nav-item"}
              onClick={() => openLoop(loop.id)}
            >
              <span className="loop-nav-icon"><Activity size={14} /></span>
              <span className="loop-nav-copy">
                <strong>{loop.contract.name}</strong>
                <small>Cycle {loop.cycles.at(-1)?.number} · {STATUS_LABEL[loop.status]}</small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
          {!loading && loops.length === 0 && <p className="empty-nav">还没有 Loop。先从一个四周内可验证的问题开始。</p>}
        </nav>

        <div className="sidebar-footer">
          <div className={agent?.reachable && agent.configured ? "agent-dot online" : "agent-dot"} />
          <div>
            <strong>dsh Agent</strong>
            <span>{agent?.reachable && agent.configured ? "已连接" : "尚未就绪"}</span>
          </div>
          <button onClick={() => void load()} aria-label="重新检查 Agent"><RefreshCw size={14} /></button>
        </div>
      </aside>

      <main className="main-stage">
        <header className="topbar">
          <div className="local-badge"><HardDrive size={14} /> 本地运行 · 数据保存在这台设备</div>
          <div className="topbar-right">{view === "quant" ? "Quant Loop Prototype" : "Core + Local Web"} <span>v0.1</span></div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <TriangleAlert size={18} />
            <span>{error}</span>
            <button onClick={() => setError(undefined)} aria-label="关闭错误"><X size={16} /></button>
          </div>
        )}

        {view === "quant" ? (
          <QuantLoopPrototype />
        ) : loading ? (
          <div className="loading-view"><LoaderCircle className="spin" /> 正在读取本地事件…</div>
        ) : view === "new" ? (
          <NewLoopForm onCancel={() => setView(loops.length ? "loop" : "home")} onCreate={createLoop} busy={busy} />
        ) : view === "loop" && selected ? (
          <LoopDetail loop={selected} agent={agent} busy={busy} onAction={performAction} />
        ) : (
          <Home loops={loops} onCreate={() => setView("new")} onOpen={openLoop} />
        )}
      </main>
    </div>
  );
}

function Home({ loops, onCreate, onOpen }: { loops: LoopAggregate[]; onCreate: () => void; onOpen: (id: string) => void }) {
  const active = loops.filter((loop) => loop.status !== "completed").length;
  const cycles = loops.reduce((sum, loop) => sum + loop.cycles.filter((cycle) => cycle.status === "completed").length, 0);

  return (
    <div className="home-view">
      <section className="home-hero">
        <div className="eyebrow"><span /> HUMAN × AGENT CLOSED LOOP</div>
        <h1>不要只完成任务。<br /><em>让系统学会。</em></h1>
        <p>把模糊愿望编译成可检验的目标，让人先判断、Agent 再提出异议，最后用现实证据更新下一轮。</p>
        <div className="hero-actions">
          <button className="primary-button" onClick={onCreate}>构建第一个 Loop <ArrowRight size={17} /></button>
          <span>无需账号 · 无需云端 · 可完整导出</span>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-center">LOOP</div>
          <span className="orbit-node node-a">目标</span>
          <span className="orbit-node node-b">模型</span>
          <span className="orbit-node node-c">证据</span>
          <span className="orbit-node node-d">修订</span>
        </div>
      </section>

      <section className="home-stats" aria-label="本地 Loop 概况">
        <div><span>{loops.length}</span><small>本地 Loops</small></div>
        <div><span>{active}</span><small>正在运行</small></div>
        <div><span>{cycles}</span><small>已验证周期</small></div>
        <div><span>0</span><small>云端依赖</small></div>
      </section>

      {loops.length > 0 && (
        <section className="recent-section">
          <div className="section-heading"><div><span className="section-kicker">RECENT SYSTEMS</span><h2>继续一个 Loop</h2></div></div>
          <div className="recent-grid">
            {loops.slice(0, 3).map((loop) => (
              <button className="recent-card" key={loop.id} onClick={() => onOpen(loop.id)}>
                <div className="recent-card-top"><span className={`status-dot status-${loop.status}`} />{STATUS_LABEL[loop.status]}<ChevronRight size={16} /></div>
                <h3>{loop.contract.name}</h3>
                <p>{loop.contract.intent}</p>
                <div className="recent-card-meta"><span>Cycle {loop.cycles.at(-1)?.number}</span><span>{loop.contract.budget.attentionMinutes} min</span></div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="four-lenses">
        <div className="section-heading"><div><span className="section-kicker">THE OPERATING MODEL</span><h2>四个对象，不是一张待办清单</h2></div></div>
        <div className="lens-grid">
          <Lens icon={<Target />} number="01" title="目标函数" text="明确要优化什么、如何加权，以及哪些底线绝不能穿越。" />
          <Lens icon={<BrainCircuit />} number="02" title="世界模型" text="写下暂时解释、置信度和什么证据会证明它错了。" />
          <Lens icon={<TimerReset />} number="03" title="反馈回路" text="行动不是终点；现实证据必须回到模型和下一轮策略。" />
          <Lens icon={<Gauge />} number="04" title="预算带宽" text="注意力、精力和模型成本都是明确的硬约束。" />
        </div>
      </section>
    </div>
  );
}

function Lens({ icon, number, title, text }: { icon: ReactNode; number: string; title: string; text: string }) {
  return <article className="lens-card"><div className="lens-icon">{icon}</div><span>{number}</span><h3>{title}</h3><p>{text}</p></article>;
}

function NewLoopForm({ onCancel, onCreate, busy }: { onCancel: () => void; onCreate: (input: CreateLoopInput) => Promise<void>; busy: boolean }) {
  const [confidence, setConfidence] = useState(55);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void onCreate({
      name: String(data.get("name")),
      intent: String(data.get("intent")),
      horizon: String(data.get("horizon")),
      objectives: [
        { name: String(data.get("primaryName")), weight: 0.7, target: String(data.get("primaryTarget")) },
        { name: String(data.get("secondaryName")), weight: 0.3, target: String(data.get("secondaryTarget")), floor: String(data.get("floor")) },
      ],
      worldModel: [{ statement: String(data.get("claim")), confidence, falsifier: String(data.get("falsifier")) }],
      budget: {
        attentionMinutes: Number(data.get("attention")),
        energyLevel: String(data.get("energy")) as "low" | "medium" | "high",
        modelCostUsd: Number(data.get("modelCost")),
        cycleDays: Number(data.get("cycleDays")),
      },
      guardrails: [String(data.get("guardrail"))],
    });
  }

  return (
    <div className="form-page">
      <div className="form-intro"><span className="section-kicker">NEW LOOP CONTRACT</span><h1>把一个问题变成<br />可学习的系统。</h1><p>先定义四周内能验证的小目标。细节以后可以修订，底线和预算现在就要明确。</p></div>
      <form className="contract-form" onSubmit={submit}>
        <FormSection number="01" title="意图与时间范围" hint="不是人生目标，只是一段可以结束的循环。">
          <label>Loop 名称<input name="name" required placeholder="例如：找到可重复的内容选题方法" /></label>
          <label>想解决的问题<textarea name="intent" required rows={3} placeholder="未来四周，我想知道什么做法能稳定提高目标读者的收藏，同时不牺牲真实性。" /></label>
          <label>时间范围<input name="horizon" required defaultValue="4 weeks" /></label>
        </FormSection>
        <FormSection number="02" title="目标函数" hint="权重暂定为 70 / 30；底线不能被加权抵消。">
          <div className="form-grid two"><label>主要维度<input name="primaryName" required defaultValue="目标用户价值" /></label><label>成功长什么样<input name="primaryTarget" required placeholder="收藏率和目标读者盲评提升" /></label></div>
          <div className="form-grid two"><label>次要维度<input name="secondaryName" required defaultValue="可持续性" /></label><label>成功长什么样<input name="secondaryTarget" required defaultValue="每条内容两小时内完成" /></label></div>
          <label>不可违反的底线<input name="floor" required defaultValue="不自动发布；不追逐与定位无关的流量" /></label>
        </FormSection>
        <FormSection number="03" title="当前世界模型" hint="写下你现在相信的解释，以及什么会证明它错了。">
          <label>当前假设<textarea name="claim" required rows={2} placeholder="具体案例比抽象观点更能让目标用户收藏。" /></label>
          <div className="confidence-row"><label>当前置信度 <strong>{confidence}%</strong><input type="range" min="0" max="100" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} /></label></div>
          <label>证伪条件<textarea name="falsifier" required rows={2} placeholder="连续三组配对内容中，案例版没有获得更高盲评或收藏。" /></label>
        </FormSection>
        <FormSection number="04" title="预算与护栏" hint="系统应该保护注意力，而不是制造更多工作。">
          <div className="form-grid three"><label>注意力 / 分钟<input name="attention" type="number" min="15" required defaultValue="120" /></label><label>周期 / 天<input name="cycleDays" type="number" min="1" required defaultValue="7" /></label><label>模型成本 / USD<input name="modelCost" type="number" min="0" step="0.1" required defaultValue="2" /></label></div>
          <label>精力预算<select name="energy" defaultValue="medium"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          <label>额外护栏<input name="guardrail" required defaultValue="所有外部写入必须由人逐项确认" /></label>
        </FormSection>
        <div className="form-actions"><button type="button" className="ghost-button" onClick={onCancel}>取消</button><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />} 创建 Contract</button></div>
      </form>
    </div>
  );
}

function FormSection({ number, title, hint, children }: { number: string; title: string; hint: string; children: ReactNode }) {
  return <fieldset><legend><span>{number}</span><div><strong>{title}</strong><small>{hint}</small></div></legend>{children}</fieldset>;
}

function LoopDetail({ loop, agent, busy, onAction }: { loop: LoopAggregate; agent: AgentStatus | undefined; busy: boolean; onAction: (payload: unknown) => Promise<void> }) {
  const cycle = loop.cycles.at(-1)!;
  const completedSteps = [cycle.humanPrior, cycle.agentAdvice, cycle.decision, cycle.observation, cycle.revision].filter(Boolean).length;

  return (
    <div className="loop-page">
      <section className="loop-header">
        <div><span className="section-kicker">LOOP CONTRACT · CYCLE {cycle.number}</span><h1>{loop.contract.name}</h1><p>{loop.contract.intent}</p></div>
        <div className="loop-header-actions"><span className={`status-pill status-${loop.status}`}>{STATUS_LABEL[loop.status]}</span><a className="icon-button" href={`/api/loops/${loop.id}/export`} download aria-label="导出 Loop"><Download size={17} /></a></div>
      </section>

      <div className="progress-track">
        {STEPS.map((step, index) => <div className={index < completedSteps ? "progress-step complete" : index === completedSteps ? "progress-step current" : "progress-step"} key={step}><span>{index < completedSteps ? <Check size={13} /> : index + 1}</span><small>{step}</small></div>)}
      </div>

      <section className="contract-lenses">
        <article><div className="mini-icon green"><Target size={17} /></div><div><span>目标函数</span><strong>{loop.contract.objectives[0]?.name}</strong><small>{Math.round((loop.contract.objectives[0]?.weight ?? 0) * 100)}% 权重</small></div></article>
        <article><div className="mini-icon blue"><BrainCircuit size={17} /></div><div><span>世界模型</span><strong>{loop.contract.worldModel[0]?.confidence}% 置信</strong><small>{loop.contract.worldModel[0]?.statement}</small></div></article>
        <article><div className="mini-icon amber"><CircleGauge size={17} /></div><div><span>预算带宽</span><strong>{loop.contract.budget.attentionMinutes} 分钟</strong><small>${loop.contract.budget.modelCostUsd} · {loop.contract.budget.energyLevel} energy</small></div></article>
        <article><div className="mini-icon red"><ShieldCheck size={17} /></div><div><span>不可违反</span><strong>{loop.contract.objectives.find((item) => item.floor)?.floor ?? loop.contract.guardrails[0]}</strong><small>Floor / Guardrail</small></div></article>
      </section>

      <div className="workspace-grid">
        <section className="cycle-workspace">
          <div className="section-heading compact"><div><span className="section-kicker">CURRENT CYCLE</span><h2>这轮该做什么</h2></div><span className="cycle-number">{String(cycle.number).padStart(2, "0")}</span></div>

          {loop.status === "ready" && <PriorForm busy={busy} onSubmit={(payload) => onAction({ type: "record_prior", payload })} />}
          {loop.status === "awaiting_agent" && <AwaitingAgent prior={cycle.humanPrior!} agent={agent} busy={busy} onRun={() => onAction({ type: "request_advice" })} />}
          {loop.status === "awaiting_human" && <DecisionForm advice={cycle.agentAdvice!} prior={cycle.humanPrior!} busy={busy} onSubmit={(payload) => onAction({ type: "record_decision", payload })} />}
          {loop.status === "running" && <ObservationForm loop={loop} busy={busy} onSubmit={(payload) => onAction({ type: "record_observation", payload })} />}
          {loop.status === "reviewing" && <ReviewForm loop={loop} busy={busy} onSubmit={(payload) => onAction({ type: "complete_review", payload })} />}
          {loop.status === "completed" && <CompletedCycle loop={loop} />}
        </section>

        <aside className="evidence-panel">
          <span className="section-kicker">MODEL &amp; EVIDENCE</span>
          <h2>当前解释</h2>
          {loop.contract.worldModel.map((claim) => <div className="claim-card" key={claim.id}><div className="claim-confidence"><span style={{ width: `${claim.confidence}%` }} /></div><strong>{claim.statement}</strong><p>{claim.confidence}% confidence</p><small><FlaskConical size={13} /> 证伪：{claim.falsifier}</small></div>)}
          <h3>本轮预算</h3>
          <BudgetRow label="注意力" value={`${loop.contract.budget.attentionMinutes} min`} percent={cycle.observation ? cycle.observation.costMinutes / loop.contract.budget.attentionMinutes * 100 : 0} />
          <BudgetRow label="模型成本" value={`$${loop.contract.budget.modelCostUsd}`} percent={cycle.observation ? cycle.observation.modelCostUsd / loop.contract.budget.modelCostUsd * 100 : 0} />
          <div className="guardrail-note"><ShieldCheck size={16} /><div><strong>本地护栏</strong><p>{loop.contract.guardrails.join(" · ")}</p></div></div>
        </aside>
      </div>

      {loop.cycles.length > 1 && <CycleHistory loop={loop} />}
    </div>
  );
}

function PriorForm({ busy, onSubmit }: { busy: boolean; onSubmit: (prior: HumanPrior) => Promise<void> }) {
  const [confidence, setConfidence] = useState(50);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); void onSubmit({ prediction: String(data.get("prediction")), confidence, reasoning: String(data.get("reasoning")) }); }
  return <form className="step-form" onSubmit={submit}><div className="step-callout human"><span>HUMAN FIRST</span><h3>先写下你的独立判断</h3><p>在看到 Agent 建议以前锁定预测，才能识别锚定效应和真正的分歧。</p></div><label>这轮结束时，你预测会观察到什么？<textarea name="prediction" required rows={3} placeholder="写明对象、方向、幅度和截止时间。" /></label><label>为什么？<textarea name="reasoning" required rows={3} placeholder="写下证据和推理，不必写得漂亮。" /></label><div className="confidence-row"><label>置信度 <strong>{confidence}%</strong><input type="range" min="0" max="100" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} /></label></div><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />} 锁定 Prior</button></form>;
}

function AwaitingAgent({ prior, agent, busy, onRun }: { prior: HumanPrior; agent: AgentStatus | undefined; busy: boolean; onRun: () => Promise<void> }) {
  const ready = agent?.reachable && agent.configured;
  return <div className="agent-wait"><div className="locked-prior"><span>你的预测已锁定</span><strong>{prior.prediction}</strong><small>{prior.confidence}% confidence · {prior.reasoning}</small></div><div className="agent-run-card"><div className="agent-avatar"><BrainCircuit size={24} /></div><h3>让 Agent 独立分析</h3><p>进程内 dsh 会看到 Contract 和世界模型，但不会看到你本轮的 Prior，避免双方互相锚定；建议返回后再并排比较。</p><div className={ready ? "connection-state ready" : "connection-state"}><span />{agent?.message ?? "正在检查 Agent…"}</div><button className="primary-button" disabled={busy || !ready} onClick={() => void onRun()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />} 请求 Agent 建议</button>{!ready && <small className="setup-hint">在 apps/web/.env.local 配置 DEEPSEEK_API_KEY。</small>}</div></div>;
}

function DecisionForm({ advice, prior, busy, onSubmit }: { advice: NonNullable<LoopAggregate["cycles"][number]["agentAdvice"]>; prior: HumanPrior; busy: boolean; onSubmit: (decision: HumanDecision) => Promise<void> }) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); void onSubmit({ choice: String(data.get("choice")), rationale: String(data.get("rationale")), acceptedAgentAdvice: String(data.get("accepted")) as HumanDecision["acceptedAgentAdvice"] }); }
  return <div><div className="comparison-grid"><article className="comparison-card human"><span>你的 Prior · {prior.confidence}%</span><p>{prior.prediction}</p></article><article className="comparison-card agent"><span>Agent · {advice.confidence}%</span><p>{advice.prediction}</p></article></div><div className="advice-card"><span>AGENT RECOMMENDATION</span><h3>{advice.recommendation}</h3><dl><div><dt>最小实验</dt><dd>{advice.experiment}</dd></div><div><dt>最强反证</dt><dd>{advice.strongestCounterargument}</dd></div><div><dt>需要的证据</dt><dd>{advice.evidenceNeeded.join(" · ")}</dd></div></dl></div><form className="step-form decision" onSubmit={submit}><h3>决定由人签署</h3><label>最终选择<textarea name="choice" required rows={2} defaultValue={advice.experiment} /></label><label>为什么这样决定？<textarea name="rationale" required rows={2} /></label><label>你对 Agent 建议的采纳程度<select name="accepted" defaultValue="partial"><option value="yes">采纳</option><option value="partial">部分采纳</option><option value="no">不采纳</option></select></label><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} 签署并开始实验</button></form></div>;
}

function ObservationForm({ loop, busy, onSubmit }: { loop: LoopAggregate; busy: boolean; onSubmit: (observation: Observation) => Promise<void> }) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const objectiveScores = Object.fromEntries(loop.contract.objectives.map((objective) => [objective.name, Number(data.get(`score-${objective.id}`))])); void onSubmit({ outcome: String(data.get("outcome")), evidence: String(data.get("evidence")), objectiveScores, costMinutes: Number(data.get("costMinutes")), modelCostUsd: Number(data.get("modelCost")) }); }
  const cycle = loop.cycles.at(-1)!;
  return <div><div className="step-callout running"><span>EXPERIMENT RUNNING</span><h3>{cycle.decision?.choice}</h3><p>{cycle.decision?.rationale}</p></div><form className="step-form" onSubmit={submit}><label>现实中发生了什么？<textarea name="outcome" required rows={3} placeholder="只记录观察，不把解释混在结果里。" /></label><label>证据在哪里？<textarea name="evidence" required rows={2} placeholder="数据、文件、访谈、测试结果或可复查的记录。" /></label><div className="form-grid two">{loop.contract.objectives.map((objective) => <label key={objective.id}>{objective.name} / 100<input name={`score-${objective.id}`} type="number" min="0" max="100" required defaultValue="50" /></label>)}</div><div className="form-grid two"><label>实际注意力 / 分钟<input name="costMinutes" type="number" min="0" max={loop.contract.budget.attentionMinutes} required /></label><label>实际模型成本 / USD<input name="modelCost" type="number" min="0" max={loop.contract.budget.modelCostUsd} step="0.01" required defaultValue="0" /></label></div><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <FlaskConical size={17} />} 提交 Reality Check</button></form></div>;
}

function ReviewForm({ loop, busy, onSubmit }: { loop: LoopAggregate; busy: boolean; onSubmit: (revision: Revision) => Promise<void> }) {
  const cycle = loop.cycles.at(-1)!;
  const predictionDelta = Math.abs((cycle.humanPrior?.confidence ?? 0) - (cycle.agentAdvice?.confidence ?? 0));
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); void onSubmit({ modelUpdate: String(data.get("modelUpdate")), strategyUpdate: String(data.get("strategyUpdate")), confidenceDelta: Number(data.get("confidenceDelta")), startNextCycle: data.get("nextCycle") === "on" }); }
  return <div><div className="review-summary"><article><span>人机置信差</span><strong>{predictionDelta} pts</strong></article><article><span>注意力使用</span><strong>{cycle.observation?.costMinutes} min</strong></article><article><span>模型成本</span><strong>${cycle.observation?.modelCostUsd}</strong></article></div><div className="evidence-result"><span>REALITY CHECK</span><h3>{cycle.observation?.outcome}</h3><p>{cycle.observation?.evidence}</p></div><form className="step-form" onSubmit={submit}><label>世界模型应如何更新？<textarea name="modelUpdate" required rows={3} placeholder="哪条假设增强、减弱或被推翻？为什么？" /></label><label>下一轮策略应如何改变？<textarea name="strategyUpdate" required rows={3} placeholder="保留什么、停止什么、下一次只改变哪个变量？" /></label><label>置信度变化（-100 到 100）<input name="confidenceDelta" type="number" min="-100" max="100" required defaultValue="0" /></label><label className="checkbox-row"><input type="checkbox" name="nextCycle" defaultChecked /><span><strong>立即开始下一轮</strong><small>保留本轮历史，创建一个新的空 Cycle。</small></span></label><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <TimerReset size={17} />} 完成 Revision</button></form></div>;
}

function CompletedCycle({ loop }: { loop: LoopAggregate }) {
  const cycle = loop.cycles.at(-1)!;
  return <div className="completed-card"><div className="completion-mark"><Check /></div><span>LOOP CLOSED</span><h3>这轮不只是完成了任务，还更新了判断。</h3><dl><div><dt>模型更新</dt><dd>{cycle.revision?.modelUpdate}</dd></div><div><dt>策略更新</dt><dd>{cycle.revision?.strategyUpdate}</dd></div></dl><p>如果要继续，请在上一轮复盘时勾选“立即开始下一轮”。</p></div>;
}

function BudgetRow({ label, value, percent }: { label: string; value: string; percent: number }) {
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  return <div className="budget-row"><div><span>{label}</span><strong>{value}</strong></div><div className="budget-track"><span style={{ width: `${safePercent}%` }} /></div></div>;
}

function CycleHistory({ loop }: { loop: LoopAggregate }) {
  return <section className="history-section"><span className="section-kicker">CYCLE HISTORY</span><h2>模型是怎样改变的</h2><div className="history-list">{loop.cycles.slice(0, -1).reverse().map((cycle) => <article key={cycle.id}><span>Cycle {cycle.number}</span><div><strong>{cycle.revision?.modelUpdate}</strong><p>{cycle.observation?.outcome}</p></div><small>{cycle.completedAt ? new Date(cycle.completedAt).toLocaleDateString("zh-CN") : "—"}</small></article>)}</div></section>;
}
