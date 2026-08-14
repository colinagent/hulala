"use client";

import {
  ArrowRight,
  BrainCircuit,
  Check,
  CircleGauge,
  FlaskConical,
  Gauge,
  LockKeyhole,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import styles from "./quant-loop-prototype.module.css";

type Stage = 0 | 1 | 2 | 3 | 4;
type CandidateKey = "a" | "b" | "c";

interface Metrics {
  annualReturn: number;
  maxDrawdown: number;
  sharpe: number;
  turnover: number;
}

interface Candidate {
  key: CandidateKey;
  name: string;
  change: string;
  rationale: string;
  risk: string;
  metrics: Metrics;
  curve: number[];
}

const STEPS = ["人的 Prior", "Agent 反证", "人的决定", "现实证据", "模型修订"];

const BASELINE: Metrics = {
  annualReturn: 18.7,
  maxDrawdown: 23.4,
  sharpe: 0.86,
  turnover: 286,
};

const BASELINE_CURVE = [
  100, 101, 103, 102, 105, 107, 106, 104, 108, 111, 109, 107, 108, 105, 102, 101,
  99, 101, 104, 108, 111, 112, 115, 114, 118, 120, 119, 117, 121, 124, 126, 125,
];

const CANDIDATES: Record<CandidateKey, Candidate> = {
  a: {
    key: "a",
    name: "趋势强度过滤",
    change: "只在 ADX > 22 时接受均线信号",
    rationale: "直接针对震荡期反复开平仓，但可能错过趋势早期。",
    risk: "阈值敏感性",
    metrics: { annualReturn: 24.9, maxDrawdown: 18.6, sharpe: 1.12, turnover: 188 },
    curve: [100, 101, 103, 104, 106, 108, 108, 109, 111, 113, 112, 113, 115, 116, 115, 116, 119, 121, 123, 126, 127, 129, 131, 132, 135, 137, 138, 140, 142, 145, 147, 150],
  },
  b: {
    key: "b",
    name: "波动率目标仓位",
    change: "按 20 日波动率把组合风险稳定在 12%",
    rationale: "降低极端行情暴露，优先保护回撤，但没有处理无效交易。",
    risk: "快速反转滞后",
    metrics: { annualReturn: 22.8, maxDrawdown: 12.8, sharpe: 1.29, turnover: 213 },
    curve: [100, 101, 102, 103, 105, 106, 107, 108, 110, 111, 111, 112, 113, 114, 113, 114, 116, 119, 121, 123, 125, 127, 128, 130, 132, 134, 136, 138, 140, 142, 144, 147],
  },
  c: {
    key: "c",
    name: "状态过滤 + 风险仓位",
    change: "趋势强度决定是否交易，波动率决定交易多少",
    rationale: "同时修复交易频率与风险暴露，规则仍然可解释。",
    risk: "规则复杂度上升",
    metrics: { annualReturn: 28.6, maxDrawdown: 11.9, sharpe: 1.51, turnover: 142 },
    curve: [100, 102, 103, 105, 107, 109, 110, 111, 114, 116, 116, 117, 119, 121, 120, 122, 125, 128, 131, 134, 136, 138, 141, 143, 146, 149, 151, 154, 157, 160, 163, 166],
  },
};

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function metricDelta(after: number, before: number, inverse = false) {
  const delta = after - before;
  const improved = inverse ? delta < 0 : delta > 0;
  return { delta: Math.abs(delta), improved };
}

function chartPath(points: number[]) {
  const left = 38;
  const top = 14;
  const width = 682;
  const height = 218;
  const min = 92;
  const max = 170;
  return points
    .map((point, index) => {
      const x = left + (index / (points.length - 1)) * width;
      const y = top + (1 - (point - min) / (max - min)) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function QuantLoopPrototype() {
  const [stage, setStage] = useState<Stage>(0);
  const [cycleNumber, setCycleNumber] = useState(1);
  const [confidence, setConfidence] = useState(62);
  const [hypothesis, setHypothesis] = useState("趋势跟随策略的主要亏损来自震荡期的反复假信号；增加趋势过滤应该能降低回撤，同时保留大部分收益。");
  const [agentBusy, setAgentBusy] = useState(false);
  const [adviceReady, setAdviceReady] = useState(false);
  const [candidateKey, setCandidateKey] = useState<CandidateKey>("c");
  const [decisionRationale, setDecisionRationale] = useState("先采用组合方案，但要求在样本外区间同时通过回撤、换手率和参数敏感性检查。");
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceReady, setEvidenceReady] = useState(false);

  const candidate = CANDIDATES[candidateKey];

  async function requestAgentAdvice() {
    setAgentBusy(true);
    await delay(900);
    setAdviceReady(true);
    setAgentBusy(false);
  }

  async function runBacktest() {
    setEvidenceBusy(true);
    await delay(1100);
    setEvidenceReady(true);
    setEvidenceBusy(false);
  }

  function beginNextCycle() {
    setCycleNumber((current) => current + 1);
    setStage(0);
    setConfidence(74);
    setHypothesis(`上一轮证据支持“市场状态影响策略有效性”。下一轮需要验证：${candidate.risk}是否会让结果在不同参数下失效。`);
    setAdviceReady(false);
    setEvidenceReady(false);
    setCandidateKey("c");
  }

  return (
    <div className={styles.page}>
      <section className={styles.header}>
        <div>
          <span className="section-kicker">QUANT STRATEGY PROTOTYPE</span>
          <h1>让一条策略，<br />不断被证据纠正。</h1>
          <p>这不是 AI 自动炒股。人先写下判断，Agent 独立提出反证，人决定做什么实验，最后只让样本外证据更新下一轮。</p>
        </div>
        <div className={styles.headerMeta}>
          <span>Cycle {String(cycleNumber).padStart(2, "0")}</span>
          <strong>交互原型 · 模拟回测</strong>
        </div>
      </section>

      <section className={styles.contractBar} aria-label="本轮 Loop Contract">
        <ContractItem icon={<TrendingUp size={17} />} label="目标函数" value="提高风险调整后收益" detail="Sharpe 60% · 回撤 40%" />
        <ContractItem icon={<FlaskConical size={17} />} label="证伪条件" value="样本外改善不足" detail="或参数变化后失效" />
        <ContractItem icon={<Gauge size={17} />} label="预算带宽" value="3 个候选 · 1 轮" detail="只改变两个变量" />
        <ContractItem icon={<ShieldCheck size={17} />} label="不可违反" value="不接触真实资金" detail="含成本 · 时间隔离" />
      </section>

      <section className={styles.stepRail} aria-label="Loop 使用步骤">
        {STEPS.map((label, index) => {
          const complete = index < stage || (index === 3 && stage === 3 && evidenceReady);
          const current = index === stage;
          return (
            <div className={`${styles.step} ${complete ? styles.complete : ""} ${current ? styles.current : ""}`} key={label}>
              <span>{complete ? <Check size={13} /> : index + 1}</span>
              <small>{label}</small>
            </div>
          );
        })}
      </section>

      <div className={styles.workspace}>
        <main className={styles.stagePanel}>
          {stage === 0 && (
            <PriorStage
              confidence={confidence}
              hypothesis={hypothesis}
              onConfidence={setConfidence}
              onHypothesis={setHypothesis}
              onContinue={() => setStage(1)}
            />
          )}

          {stage === 1 && (
            <AgentStage
              hypothesis={hypothesis}
              confidence={confidence}
              busy={agentBusy}
              ready={adviceReady}
              onRun={requestAgentAdvice}
              onContinue={() => setStage(2)}
            />
          )}

          {stage === 2 && (
            <DecisionStage
              hypothesis={hypothesis}
              confidence={confidence}
              candidateKey={candidateKey}
              rationale={decisionRationale}
              onCandidate={setCandidateKey}
              onRationale={setDecisionRationale}
              onContinue={() => setStage(3)}
            />
          )}

          {stage === 3 && (
            <EvidenceStage
              candidate={candidate}
              rationale={decisionRationale}
              busy={evidenceBusy}
              ready={evidenceReady}
              onRun={runBacktest}
              onContinue={() => setStage(4)}
            />
          )}

          {stage === 4 && (
            <RevisionStage candidate={candidate} confidence={confidence} onNext={beginNextCycle} />
          )}
        </main>

        <aside className={styles.valuePanel}>
          <span className="section-kicker">WHY THIS LOOP MATTERS</span>
          <h2>用户得到的不是答案，<br />而是更好的判断。</h2>
          <div className={styles.valueSequence}>
            <ValueItem number="01" title="先暴露自己的模型" text="看到 AI 以前锁定预测，避免把 AI 的话误认为自己的判断。" active={stage === 0} />
            <ValueItem number="02" title="把分歧变成实验" text="Agent 的价值是提出反证和最小测试，不是给一个不可追责的结论。" active={stage === 1 || stage === 2} />
            <ValueItem number="03" title="让证据进入下一轮" text="回测不是终点；结果会明确改变置信度、规则和下一轮问题。" active={stage >= 3} />
          </div>

          <div className={styles.baselineCard}>
            <div className={styles.baselineTitle}><CircleGauge size={17} /><strong>当前基线</strong><span>样本外</span></div>
            <MetricRow label="年化收益" value={`${BASELINE.annualReturn}%`} />
            <MetricRow label="最大回撤" value={`−${BASELINE.maxDrawdown}%`} />
            <MetricRow label="夏普比率" value={BASELINE.sharpe.toFixed(2)} />
            <MetricRow label="年换手率" value={`${BASELINE.turnover}%`} />
          </div>

          <p className={styles.disclaimer}><ShieldCheck size={13} /> 数据为确定性模拟，只用于验证产品体验，不构成投资建议。</p>
        </aside>
      </div>
    </div>
  );
}

function ContractItem({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <article><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></article>;
}

function ValueItem({ number, title, text, active }: { number: string; title: string; text: string; active: boolean }) {
  return <article className={active ? styles.valueActive : ""}><span>{number}</span><div><strong>{title}</strong><p>{text}</p></div></article>;
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return <div className={styles.metricRow}><span>{label}</span><strong>{value}</strong></div>;
}

function StageHeading({ kicker, title, text }: { kicker: string; title: string; text: string }) {
  return <div className={styles.stageHeading}><span className="section-kicker">{kicker}</span><h2>{title}</h2><p>{text}</p></div>;
}

function LockedPrior({ hypothesis, confidence }: { hypothesis: string; confidence: number }) {
  return (
    <div className={styles.lockedPrior}>
      <LockKeyhole size={17} />
      <div><span>你的 Prior 已锁定 · {confidence}% confidence</span><strong>{hypothesis}</strong></div>
    </div>
  );
}

function PriorStage({
  confidence,
  hypothesis,
  onConfidence,
  onHypothesis,
  onContinue,
}: {
  confidence: number;
  hypothesis: string;
  onConfidence: (value: number) => void;
  onHypothesis: (value: string) => void;
  onContinue: () => void;
}) {
  return (
    <div>
      <StageHeading kicker="STEP 01 · HUMAN FIRST" title="在看 AI 以前，你相信什么？" text="先把人的预测和置信度写下来。没有这一笔，最后就无法判断 AI 究竟改变了什么。" />
      <div className={styles.promptCard}>
        <span>研究问题</span>
        <h3>怎样减少趋势策略在震荡市里的无效交易，同时把最大回撤控制在 15% 以内？</h3>
        <div className={styles.contextTags}><span>沪深300</span><span>2018—2025</span><span>含 0.08% 单边成本</span><span>70 / 30 时间切分</span></div>
      </div>
      <label className={styles.field}>你的当前假设
        <textarea rows={4} value={hypothesis} onChange={(event) => onHypothesis(event.target.value)} />
      </label>
      <label className={styles.rangeField}>
        <span>你有多相信这个解释？<strong>{confidence}%</strong></span>
        <input type="range" min="0" max="100" value={confidence} onChange={(event) => onConfidence(Number(event.target.value))} />
      </label>
      <button className="primary-button" onClick={onContinue} disabled={!hypothesis.trim()}><LockKeyhole size={16} /> 锁定 Prior <ArrowRight size={16} /></button>
    </div>
  );
}

function AgentStage({
  hypothesis,
  confidence,
  busy,
  ready,
  onRun,
  onContinue,
}: {
  hypothesis: string;
  confidence: number;
  busy: boolean;
  ready: boolean;
  onRun: () => Promise<void>;
  onContinue: () => void;
}) {
  return (
    <div>
      <StageHeading kicker="STEP 02 · INDEPENDENT AGENT" title="让 Agent 找你的盲区。" text="Agent 只看到 Contract、策略规则和基线数据，不会看到你的 Prior，避免双方互相锚定。" />
      <LockedPrior hypothesis={hypothesis} confidence={confidence} />
      {!ready ? (
        <div className={styles.runAgentCard}>
          <div><BrainCircuit size={26} /></div>
          <h3>{busy ? "正在独立分析基线…" : "准备一次独立诊断"}</h3>
          <p>{busy ? "按上涨、震荡、下跌市场状态拆解损失，并寻找最小可验证改动。" : "模拟 Agent 对本地策略摘要做结构化分析；不会连接券商，也不会提交订单。"}</p>
          <button className="primary-button" disabled={busy} onClick={() => void onRun()}>{busy ? <RefreshCw className={styles.spin} size={16} /> : <Sparkles size={16} />} {busy ? "Agent 分析中" : "请求 Agent 反证"}</button>
        </div>
      ) : (
        <div className={styles.agentResult}>
          <div className={styles.agentResultHead}><span><BrainCircuit size={17} /> AGENT CHALLENGE</span><strong>74% confidence</strong></div>
          <h3>人的方向基本正确，但“过滤信号”只解释了一半问题。</h3>
          <dl>
            <div><dt>发现</dt><dd>震荡期无效交易贡献了 41% 的亏损；极端波动阶段的固定仓位又贡献了 37% 的回撤。</dd></div>
            <div><dt>反证</dt><dd>只增加趋势过滤会降低交易次数，但无法把回撤稳定压到 15% 以下。</dd></div>
            <div><dt>最小实验</dt><dd>分别测试“趋势强度过滤”“波动率目标仓位”和两者组合，保持其余规则不变。</dd></div>
          </dl>
          <button className="primary-button" onClick={onContinue}>比较方案并决定 <ArrowRight size={16} /></button>
        </div>
      )}
    </div>
  );
}

function DecisionStage({
  hypothesis,
  confidence,
  candidateKey,
  rationale,
  onCandidate,
  onRationale,
  onContinue,
}: {
  hypothesis: string;
  confidence: number;
  candidateKey: CandidateKey;
  rationale: string;
  onCandidate: (key: CandidateKey) => void;
  onRationale: (value: string) => void;
  onContinue: () => void;
}) {
  return (
    <div>
      <StageHeading kicker="STEP 03 · HUMAN DECISION" title="AI 可以建议，实验必须由人签署。" text="选择你愿意让证据检验的改动，并写下理由。系统保留被拒绝方案，不把 AI 建议偷偷变成行动。" />
      <div className={styles.comparisonGrid}>
        <article><span>HUMAN PRIOR · {confidence}%</span><p>{hypothesis}</p></article>
        <article><span>AGENT CHALLENGE · 74%</span><p>需要同时测试信号质量和风险暴露；只调入场规则不足以满足回撤目标。</p></article>
      </div>
      <div className={styles.candidateGrid}>
        {(Object.values(CANDIDATES) as Candidate[]).map((item) => (
          <button className={candidateKey === item.key ? styles.candidateSelected : ""} key={item.key} onClick={() => onCandidate(item.key)}>
            <span>方案 {item.key.toUpperCase()}</span>
            <strong>{item.name}</strong>
            <p>{item.change}</p>
            <small>主要风险：{item.risk}</small>
            {candidateKey === item.key && <i><Check size={13} /> 已选择</i>}
          </button>
        ))}
      </div>
      <label className={styles.field}>你的决定理由
        <textarea rows={3} value={rationale} onChange={(event) => onRationale(event.target.value)} />
      </label>
      <button className="primary-button" onClick={onContinue} disabled={!rationale.trim()}><Check size={16} /> 签署并开始实验</button>
    </div>
  );
}

function EvidenceStage({
  candidate,
  rationale,
  busy,
  ready,
  onRun,
  onContinue,
}: {
  candidate: Candidate;
  rationale: string;
  busy: boolean;
  ready: boolean;
  onRun: () => Promise<void>;
  onContinue: () => void;
}) {
  return (
    <div>
      <StageHeading kicker="STEP 04 · REALITY CHECK" title="现在让证据说话。" text="训练区间只能形成候选，最终结论来自被隔离的样本外区间，并同时检查收益、回撤和换手率。" />
      <div className={styles.signedDecision}><Check size={17} /><div><span>已签署 · 方案 {candidate.key.toUpperCase()}</span><strong>{candidate.name}</strong><p>{rationale}</p></div></div>
      {!ready ? (
        <div className={styles.backtestRun}>
          <div className={styles.testDiagram} aria-hidden="true"><span>训练 70%</span><i /><span>隔离验证 30%</span></div>
          <h3>{busy ? "正在运行样本外检验…" : "实验已就绪"}</h3>
          <p>{busy ? "计算交易成本、最大回撤、换手率和参数扰动结果。" : "本次只比较原始基线与已签署方案，未入选的候选不会被事后挑选。"}</p>
          <button className="primary-button" disabled={busy} onClick={() => void onRun()}>{busy ? <RefreshCw className={styles.spin} size={16} /> : <Play size={16} />} {busy ? "回测运行中" : "运行 Reality Check"}</button>
        </div>
      ) : (
        <>
          <EquityChart candidate={candidate} />
          <MetricComparison candidate={candidate} />
          <div className={styles.evidenceVerdict}><Check size={18} /><div><strong>证据通过预设门槛</strong><p>回撤低于 15%，夏普提升，换手率下降；在 ±15% 参数扰动下方向一致。这个结果可以进入模型修订。</p></div></div>
          <button className="primary-button" onClick={onContinue}>用证据修订世界模型 <ArrowRight size={16} /></button>
        </>
      )}
    </div>
  );
}

function RevisionStage({ candidate, confidence, onNext }: { candidate: Candidate; confidence: number; onNext: () => void }) {
  const nextConfidence = Math.min(92, confidence + 14);
  return (
    <div>
      <StageHeading kicker="STEP 05 · MODEL REVISION" title="任务结束了，系统学到了什么？" text="把结果写回世界模型和策略规则。下一轮不从空白开始，而是从这次被证据改变的判断开始。" />
      <EquityChart candidate={candidate} />
      <div className={styles.revisionGrid}>
        <article>
          <span>BEFORE</span>
          <strong>{confidence}% confidence</strong>
          <p>主要亏损来自震荡期假信号；增加趋势过滤即可显著改善。</p>
        </article>
        <ArrowRight size={20} />
        <article>
          <span>AFTER</span>
          <strong>{nextConfidence}% confidence</strong>
          <p>市场状态同时影响信号质量和风险暴露；过滤是否交易与控制交易多少需要一起验证。</p>
        </article>
      </div>
      <div className={styles.learnedCard}>
        <div><Sparkles size={19} /></div>
        <div><span>这一轮真正产生的价值</span><h3>AI 没有替用户做决定；它让一个模糊直觉变成了可证伪、可比较、可积累的判断。</h3><p>保留了人的原始预测、Agent 的分歧、签署过的实验、样本外证据和最终修订。下一次遇到类似问题，用户不必重新猜。</p></div>
      </div>
      <button className="primary-button" onClick={onNext}><RefreshCw size={16} /> 带着新模型进入 Cycle 02</button>
    </div>
  );
}

function EquityChart({ candidate }: { candidate: Candidate }) {
  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHead}><div><strong>样本外净值</strong><span>含成本 · 未使用未来数据</span></div><div><span><i className={styles.baseLegend} /> 原始基线</span><span><i className={styles.newLegend} /> 已签署方案</span></div></div>
      <svg viewBox="0 0 750 255" role="img" aria-label={`原始策略与${candidate.name}的样本外净值对比`}>
        {[40, 88, 136, 184, 232].map((y, index) => <g key={y}><line x1="38" y1={y} x2="720" y2={y} /><text x="3" y={y + 3}>{170 - index * 20}</text></g>)}
        <path className={styles.baseLine} d={chartPath(BASELINE_CURVE)} />
        <path className={styles.candidateLine} d={chartPath(candidate.curve)} />
        <line className={styles.regimeLine} x1="365" y1="14" x2="365" y2="232" />
        <text className={styles.regimeLabel} x="373" y="28">震荡期</text>
        <text x="38" y="252">2021</text><text x="208" y="252">2022</text><text x="379" y="252">2023</text><text x="550" y="252">2024</text><text x="720" y="252" textAnchor="end">2025</text>
      </svg>
    </div>
  );
}

function MetricComparison({ candidate }: { candidate: Candidate }) {
  const items = [
    { label: "年化收益", before: BASELINE.annualReturn, after: candidate.metrics.annualReturn, suffix: "%", inverse: false },
    { label: "最大回撤", before: BASELINE.maxDrawdown, after: candidate.metrics.maxDrawdown, suffix: "%", inverse: true },
    { label: "夏普比率", before: BASELINE.sharpe, after: candidate.metrics.sharpe, suffix: "", inverse: false },
    { label: "年换手率", before: BASELINE.turnover, after: candidate.metrics.turnover, suffix: "%", inverse: true },
  ];
  return (
    <div className={styles.metricGrid}>
      {items.map((item) => {
        const change = metricDelta(item.after, item.before, item.inverse);
        return <article key={item.label}><span>{item.label}</span><div><del>{item.before}{item.suffix}</del><ArrowRight size={13} /><strong>{item.after}{item.suffix}</strong></div><small className={change.improved ? styles.improved : ""}>{item.inverse ? <TrendingDown size={12} /> : <TrendingUp size={12} />} 改善 {change.delta.toFixed(item.suffix ? 1 : 2)}{item.suffix}</small></article>;
      })}
    </div>
  );
}
