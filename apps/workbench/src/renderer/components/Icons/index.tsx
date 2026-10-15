import React from 'react';
import { IconButton, type IconButtonVariant } from '../IconButton';

type IconProps = {
  className?: string;
};

// 工作区图标 - 简洁文件夹带层级线条
export const WorkspaceIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    <rect x="8" y="13.25" width="8" height="1.5" rx="0.75" fill="currentColor" stroke="none" />
  </svg>
);

// Agent 图标 - Spark/闪光风格，代表 AI 智能
export const AgentSparkIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3v5M12 16v5M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M3 12h5M16 12h5M5.6 18.4l3.5-3.5M14.9 9.1l3.5-3.5" />
  </svg>
);

// Agent 图标 - 屏幕脸风格
export const AgentBotIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.35"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="5" y="6" width="14" height="11" rx="1.5" />
    <circle cx="9.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

// Agent 图标 - 魔法棒/Wand 风格
export const AgentWandIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2l-1.4-1.4M3 21l9-9" />
    <circle cx="15" cy="9" r="3" />
  </svg>
);

// Agent 图标 - 大脑/Brain 风格
export const AgentBrainIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 5a3 3 0 00-3 3c0 1 .5 1.5 1 2s1 1.5 1 2.5V20" />
    <path d="M9.5 9.4A4 4 0 006 13a4.5 4.5 0 001 8h1" />
    <path d="M14.5 9.4A4 4 0 0118 13a4.5 4.5 0 01-1 8h-1" />
    <path d="M12 5a3 3 0 013 3c0 1-.5 1.5-1 2s-1 1.5-1 2.5" />
    <path d="M8 20h8" />
  </svg>
);

export { BrainNetworkIcon } from './BrainNetworkIcon';
export { HulalaLogo } from './HulalaLogo';

// Agent 图标 - 简约 CPU/芯片风格
export const AgentChipIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="5" y="5" width="14" height="14" rx="2" />
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </svg>
);

// Agent 图标 - 神经网络节点风格
export const AgentNeuralIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <circle cx="4" cy="6" r="2" />
    <circle cx="20" cy="6" r="2" />
    <circle cx="4" cy="18" r="2" />
    <circle cx="20" cy="18" r="2" />
    <path d="M6 7l4 3M14 10l4-3M6 17l4-3M14 14l4 3" />
  </svg>
);

// Agent 图标 - 光环/Halo 风格 (代表 AI 智慧)
export const AgentHaloIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="14" r="7" />
    <ellipse cx="12" cy="5" rx="5" ry="2" />
    <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
    <path d="M10 16.5c.8.5 1.5.5 2 .5s1.2 0 2-.5" />
  </svg>
);

// Agent 图标 - 原子/轨道核心风格
export const AgentAtomIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <ellipse cx="12" cy="12" rx="9" ry="4" />
    <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)" />
  </svg>
);

// Agent 图标 - 六边形核心风格 (蜂窝/AI网络)
export const AgentHexIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2z" />
    <circle cx="12" cy="11" r="3" />
    <path d="M12 14v3" />
  </svg>
);

// Agent 图标 - 眼睛/视觉感知风格
export const AgentEyeIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </svg>
);

// Agent 图标 - 闪电思维风格 (快速智能)
export const AgentBoltIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M13 7l-4 6h6l-4 6" />
  </svg>
);

// Agent 图标 - 三角核心风格 (简洁现代)
export const AgentTriIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3L22 20H2L12 3z" />
    <circle cx="12" cy="14" r="2" fill="currentColor" stroke="none" />
  </svg>
);

// ========== 中国风 Agent 图标 ==========

// 太极 - 阴阳智慧
export const AgentTaijiIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a10 10 0 000 20 5 5 0 000-10 5 5 0 010-10" fill="currentColor" />
    <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="17" r="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
);

// 如意 - 如心所愿
export const AgentRuyiIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 4c-3 0-5 2-5 4s2 3 5 3 5-1 5-3-2-4-5-4z" />
    <path d="M12 11v9" />
    <path d="M9 20h6" />
    <circle cx="12" cy="7" r="1" fill="currentColor" stroke="none" />
  </svg>
);

// 祥云 - 云端智能
export const AgentCloudIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 14a4 4 0 014-4 4 4 0 017.5-2A4 4 0 0120 12a4 4 0 01-4 4H6a2 2 0 01-2-2z" />
    <path d="M8 18c-1 1-1 2 0 3" />
    <path d="M12 18c-1 1.5-1 2.5 0 3.5" />
    <path d="M16 18c-1 1-1 2 0 3" />
  </svg>
);

// 中国结 - 连接网络
export const AgentKnotIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="8" y="8" width="8" height="8" rx="1" />
    <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
    <path d="M5 5l4 4M15 15l4 4M5 19l4-4M15 9l4-4" />
  </svg>
);

// 玉璧 - 天圆地方
export const AgentJadeIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
  </svg>
);

// 灯笼 - 照亮指引
export const AgentLanternIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 2h4M12 2v2" />
    <ellipse cx="12" cy="5" rx="4" ry="1" />
    <path d="M8 5c-1 2-1.5 5-1 8 .5 3 2 5 5 5s4.5-2 5-5c.5-3 0-6-1-8" />
    <ellipse cx="12" cy="18" rx="4" ry="1" />
    <path d="M10 19v2M14 19v2M9 21h6" />
    <path d="M12 8v6" />
  </svg>
);

// 印章/玺 - 权威信任
export const AgentSealIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="5" y="4" width="14" height="14" rx="2" />
    <path d="M9 8h6M9 11h6M9 14h6" />
    <path d="M8 18v2M16 18v2" />
  </svg>
);

// 八卦 - 推演变化 (基础版)
export const AgentBaguaIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M7 8h10M7 12h4M13 12h4M7 16h10" />
  </svg>
);

// 八卦 - 乾卦 (三阳爻，代表天/创造)
export const AgentQianIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <path d="M6 7h12M6 12h12M6 17h12" />
  </svg>
);

// 八卦 - 坤卦 (三阴爻，代表地/包容)
export const AgentKunIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <path d="M6 7h4M14 7h4M6 12h4M14 12h4M6 17h4M14 17h4" />
  </svg>
);

// 八卦 - 离卦 (中虚，代表火/智慧)
export const AgentLiIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <path d="M6 7h12M6 12h4M14 12h4M6 17h12" />
  </svg>
);

// 八卦 + 太极组合
export const AgentBaguaTaijiIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="5" />
    <path d="M12 7a2.5 2.5 0 000 5 2.5 2.5 0 010 5" fill="currentColor" />
    <circle cx="12" cy="9.5" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="12" cy="14.5" r="0.8" stroke="currentColor" fill="none" />
    {/* 八卦爻 */}
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2" strokeWidth="2" />
    <path d="M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeWidth="2" />
  </svg>
);

// 八卦阵 - 八方围绕
export const AgentBaguaArrayIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="12" r="9" />
    {/* 八个方位的小横线 */}
    <path d="M12 3v2" strokeWidth="2" />
    <path d="M12 19v2" strokeWidth="2" />
    <path d="M3 12h2" strokeWidth="2" />
    <path d="M19 12h2" strokeWidth="2" />
    <path d="M5.6 5.6l1.5 1.5" strokeWidth="2" />
    <path d="M16.9 16.9l1.5 1.5" strokeWidth="2" />
    <path d="M5.6 18.4l1.5-1.5" strokeWidth="2" />
    <path d="M16.9 7.1l1.5-1.5" strokeWidth="2" />
  </svg>
);

// 八卦 - 现代简约版
export const AgentBaguaModernIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M8 8h8M8 12h3M13 12h3M8 16h8" />
  </svg>
);

// 八卦 - 带外框方形版
export const AgentBaguaSquareIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 8h10M7 12h4M13 12h4M7 16h10" />
  </svg>
);

// 八卦 - 震卦 (代表雷/行动)
export const AgentZhenIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <path d="M6 7h4M14 7h4M6 12h4M14 12h4M6 17h12" />
  </svg>
);

// 八卦 - 巽卦 (代表风/渗透)
export const AgentXunIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <path d="M6 7h12M6 12h12M6 17h4M14 17h4" />
  </svg>
);

// ========== 推演系列 ==========

// 推演 - 变爻 (阴变阳，阳变阴)
export const AgentYaoIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    {/* 上：阳爻 */}
    <path d="M5 6h14" strokeWidth="2.5" />
    {/* 中：变爻（带箭头表示变化） */}
    <path d="M5 12h5M14 12h5" strokeWidth="2.5" />
    <path d="M10 10l2 2-2 2" strokeWidth="1.5" />
    {/* 下：阳爻 */}
    <path d="M5 18h14" strokeWidth="2.5" />
  </svg>
);

// 推演 - 演卦过程 (从混沌到有序)
export const AgentDeduceIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* 左：混沌圆 */}
    <circle cx="6" cy="12" r="3" />
    {/* 箭头 */}
    <path d="M11 12h4M13 10l2 2-2 2" />
    {/* 右：卦象 */}
    <path d="M18 8h3M18 12h1.2M20.8 12h1.2M18 16h3" strokeWidth="2" />
  </svg>
);

// 推演 - 蓍草占卜 (大衍之数)
export const AgentDivinationIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    {/* 蓍草束 */}
    <path d="M8 20V8M10 20V6M12 20V4M14 20V6M16 20V8" strokeWidth="2" />
    {/* 上方光芒 */}
    <path d="M12 2v1M8 3l1 1M16 3l-1 1" />
  </svg>
);

// 推演 - 卦变 (一卦变另一卦)
export const AgentMutateIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    {/* 左卦：乾 */}
    <path d="M3 7h6M3 11h6M3 15h6" strokeWidth="2" />
    {/* 变化箭头 */}
    <path d="M11 11h2M14 9l2 2-2 2" strokeWidth="1.5" />
    {/* 右卦：坤 */}
    <path d="M17 7h2M21 7h2M17 11h2M21 11h2M17 15h2M21 15h2" strokeWidth="2" />
  </svg>
);

// 推演 - 太极生两仪，两仪生四象
export const AgentGenesisIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* 顶部：太极(一) */}
    <circle cx="12" cy="4" r="2" />
    {/* 中间：两仪(二) */}
    <circle cx="8" cy="11" r="2" />
    <circle cx="16" cy="11" r="2" fill="currentColor" />
    {/* 底部：四象(四) */}
    <circle cx="5" cy="19" r="1.5" />
    <circle cx="9" cy="19" r="1.5" fill="currentColor" />
    <circle cx="15" cy="19" r="1.5" />
    <circle cx="19" cy="19" r="1.5" fill="currentColor" />
    {/* 连接线 */}
    <path d="M12 6v3M8 13v4M16 13v4" strokeWidth="1" />
  </svg>
);

// 推演 - 河图 (天地之数)
export const AgentHetuIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    {/* 中宫 */}
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    {/* 四方 */}
    <circle cx="12" cy="4" r="1.5" />
    <circle cx="12" cy="20" r="1.5" fill="currentColor" />
    <circle cx="4" cy="12" r="1.5" />
    <circle cx="20" cy="12" r="1.5" fill="currentColor" />
    {/* 四隅 */}
    <circle cx="6" cy="6" r="1" />
    <circle cx="18" cy="6" r="1" fill="currentColor" />
    <circle cx="6" cy="18" r="1" fill="currentColor" />
    <circle cx="18" cy="18" r="1" />
  </svg>
);

// 推演 - 简约版：三才 (天地人)
export const AgentSancaiIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    {/* 天 */}
    <path d="M6 5h12" />
    {/* 人 */}
    <circle cx="12" cy="12" r="3" strokeWidth="2" />
    {/* 地 */}
    <path d="M6 19h5M13 19h5" />
  </svg>
);

// ========== 二进制 × 阴阳 ==========

// 二进制阴阳 - 0/1 与爻的结合
export const AgentBinaryYaoIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    {/* 1 = 阳爻 */}
    <path d="M4 6h7" strokeWidth="2.5" />
    <text x="15" y="8" fontSize="7" fill="currentColor" stroke="none" fontFamily="monospace">1</text>
    {/* 0 = 阴爻 */}
    <path d="M4 12h3M8 12h3" strokeWidth="2.5" />
    <text x="15" y="14" fontSize="7" fill="currentColor" stroke="none" fontFamily="monospace">0</text>
    {/* 1 = 阳爻 */}
    <path d="M4 18h7" strokeWidth="2.5" />
    <text x="15" y="20" fontSize="7" fill="currentColor" stroke="none" fontFamily="monospace">1</text>
  </svg>
);

// 二进制太极 - 01 环绕
export const AgentBinaryTaijiIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a10 10 0 000 20 5 5 0 000-10 5 5 0 010-10" fill="currentColor" />
    {/* 0 在阴(黑)中 */}
    <text x="9.5" y="10" fontSize="5" fill="currentColor" stroke="none" fontFamily="monospace" fontWeight="bold">0</text>
    {/* 1 在阳(白)中 */}
    <text x="9.5" y="17" fontSize="5" stroke="none" fontFamily="monospace" fontWeight="bold">1</text>
  </svg>
);

// Bit 流 - 数据流动
export const AgentBitStreamIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    {/* 竖向的 01 流 */}
    <text x="4" y="8" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">1</text>
    <text x="4" y="15" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">0</text>
    <text x="4" y="22" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">1</text>

    <text x="10" y="5" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">0</text>
    <text x="10" y="12" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">1</text>
    <text x="10" y="19" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">1</text>

    <text x="16" y="8" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">1</text>
    <text x="16" y="15" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">0</text>
    <text x="16" y="22" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">0</text>
  </svg>
);

// 阴阳开关 - 像电路开关
export const AgentYinYangSwitchIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    {/* 上：连通 = 1 = 阳 */}
    <circle cx="6" cy="7" r="2" />
    <path d="M8 7h8" />
    <circle cx="18" cy="7" r="2" />
    {/* 下：断开 = 0 = 阴 */}
    <circle cx="6" cy="17" r="2" />
    <path d="M8 17h3M13 17h3" />
    <circle cx="18" cy="17" r="2" />
  </svg>
);

// 六十四卦矩阵 - 像 QR 码
export const Agent64GuaIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    strokeLinecap="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
    {/* 8x8 点阵，模拟二进制/卦象 */}
    <circle cx="6" cy="6" r="1" fill="currentColor" />
    <circle cx="9" cy="6" r="1" />
    <circle cx="12" cy="6" r="1" fill="currentColor" />
    <circle cx="15" cy="6" r="1" fill="currentColor" />
    <circle cx="18" cy="6" r="1" />

    <circle cx="6" cy="9" r="1" />
    <circle cx="9" cy="9" r="1" fill="currentColor" />
    <circle cx="12" cy="9" r="1" />
    <circle cx="15" cy="9" r="1" fill="currentColor" />
    <circle cx="18" cy="9" r="1" fill="currentColor" />

    <circle cx="6" cy="12" r="1" fill="currentColor" />
    <circle cx="9" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="18" cy="12" r="1" />

    <circle cx="6" cy="15" r="1" />
    <circle cx="9" cy="15" r="1" />
    <circle cx="12" cy="15" r="1" fill="currentColor" />
    <circle cx="15" cy="15" r="1" fill="currentColor" />
    <circle cx="18" cy="15" r="1" />

    <circle cx="6" cy="18" r="1" fill="currentColor" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="12" cy="18" r="1" />
    <circle cx="15" cy="18" r="1" />
    <circle cx="18" cy="18" r="1" fill="currentColor" />
  </svg>
);

// 二进制卦象 - 纯粹的 010101 排列成卦形
export const AgentBinaryGuaIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    {/* 用 0 和 1 排列成离卦 ☲ 的形状 */}
    <text x="8" y="9" fontSize="8" fill="currentColor" stroke="none" fontFamily="monospace" fontWeight="bold">1</text>
    <text x="8" y="16" fontSize="8" fill="currentColor" stroke="none" fontFamily="monospace" fontWeight="bold">0</text>
    <text x="8" y="23" fontSize="8" fill="currentColor" stroke="none" fontFamily="monospace" fontWeight="bold">1</text>
  </svg>
);

// 阴阳比特 - 圆形中的 0 和 1
export const AgentYinYangBitIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="8" cy="12" r="6" />
    <circle cx="16" cy="12" r="6" fill="currentColor" />
    <text x="5.5" y="15" fontSize="8" fill="currentColor" stroke="none" fontFamily="monospace" fontWeight="bold">0</text>
    <text x="13.5" y="15" fontSize="8" stroke="none" fontFamily="monospace" fontWeight="bold">1</text>
  </svg>
);

// 极简阴阳位 - 一条线上的 0 1
export const AgentBitLineIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="7" cy="12" r="5" />
    <circle cx="17" cy="12" r="5" fill="currentColor" />
    <text x="5" y="15" fontSize="7" fill="currentColor" stroke="none" fontFamily="monospace">0</text>
    <text x="15" y="15" fontSize="7" stroke="none" fontFamily="monospace">1</text>
    <path d="M12 7v10" strokeWidth="1" strokeDasharray="2 2" />
  </svg>
);

export const LanguagesIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m5 8 6 6" />
    <path d="m4 14 6-6 2-3" />
    <path d="M2 5h12" />
    <path d="M7 2h1" />
    <path d="m22 22-5-10-5 10" />
    <path d="M14 18h6" />
  </svg>
);

// 设置图标
export const SettingsIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08A1.65 1.65 0 0 0 10 3.25V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08A1.65 1.65 0 0 0 20.75 10H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// 搜索图标
export const SearchIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

export const GitBranchIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="6" cy="5" r="2" />
    <circle cx="18" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <path d="M6 7v10" />
    <path d="M6 9c0 0 0-4 6-4h4" />
    <path d="M6 15c0 0 0 4 6 4h4" />
    <path d="M18 7v0" />
  </svg>
);

// 终端图标
export const TerminalIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

// 终端图标 - 方形/显示器风格
export const TerminalSquareIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
    <polyline points="6 9 10 12 6 15" />
  </svg>
);

// 终端图标 - 极简命令行风格 (>_)
export const TerminalLineIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 17l6-6-6-6" />
    <path d="M12 19h8" />
  </svg>
);

// 终端图标 - 窗口风格
export const TerminalWindowIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="9" y1="14" x2="15" y2="14" />
  </svg>
);

// 终端图标 - 带光标
export const TerminalCursorIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="16" y2="19" />
    <line x1="18" y1="15" x2="18" y2="19" strokeWidth="2.5" />
  </svg>
);

// 终端图标 - $ Shell 提示符
export const TerminalShellIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <text x="7" y="16" fontSize="12" fill="currentColor" stroke="none" fontFamily="monospace" fontWeight="bold">$_</text>
  </svg>
);

// 终端图标 - 圆角 + 提示符
export const TerminalRoundedIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="4" width="20" height="16" rx="3" />
    <polyline points="6 13 9 10 6 7" strokeWidth="1.8" />
    <line x1="11" y1="13" x2="18" y2="13" strokeWidth="1.8" />
  </svg>
);

// 刷新图标 - 双弧箭头（现有）
export const RefreshIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);

// 刷新图标 - 单弧箭头（顺时针一圈）
export const RefreshSingleIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 00-9-9 9.75 9.75 0 00-6.74 2.74L3 16" />
    <path d="M3 21v-5h5" />
    <path d="M3 12a9 9 0 019 9 9.75 9.75 0 016.74-2.74L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

// 刷新图标 - 圆环+单箭头（极简）
export const RefreshCircleIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 11-2.64-6.36L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

// 刷新图标 - 弧线箭头（无折线，更圆润）
export const RefreshSmoothIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 2v6h-6" />
    <path d="M18 12a6 6 0 01-10.5 4.2" />
    <path d="M3 22v-6h6" />
    <path d="M6 12a6 6 0 0010.5-4.2" />
  </svg>
);

// 刷新图标 - 双弧对称（上下各半圆）
export const RefreshSyncIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 00-9-9 9.75 9.75 0 00-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 009 9 9.75 9.75 0 006.74-2.74L21 16" />
    <path d="M21 21v-5h-5" />
  </svg>
);

// 刷新图标 - 仅上半弧+箭头（轻量）
export const RefreshLightIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 00-9-9 9.75 9.75 0 00-6.74 2.74" />
    <path d="M3 16l5.26-5.26" />
    <path d="M3 21v-5h5" />
  </svg>
);

// 加号图标
export const PlusIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// 图钉图标
export const PinIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M5.3 2.8h5.4L9.6 6.4l2.1 2.1v1.4H8.6L8 14H6.9l-.6-4.1H3.2V8.5l2.1-2.1-1-3.6Z"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// 关闭图标
export const CloseIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// 关闭图标 - 圆形
export const CloseCircleIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

// 关闭图标 - 方形
export const CloseSquareIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="9" x2="15" y2="15" />
    <line x1="15" y1="9" x2="9" y2="15" />
  </svg>
);

// 关闭图标 - 粗体紧凑 (小尺寸友好)
export const CloseBoldIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="16" y1="8" x2="8" y2="16" />
    <line x1="8" y1="8" x2="16" y2="16" />
  </svg>
);

// 关闭图标 - 圆角短线 (macOS 风格)
export const CloseMacIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5l5 5" />
    <path d="M14.5 9.5l-5 5" />
  </svg>
);

// 关闭图标 - 减号圆形 (Dismiss)
export const CloseMinusIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);

// 关闭图标 - 禁止/Ban
export const CloseBanIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
  </svg>
);

// 最小化图标
export const MinimizeIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// 展开箭头图标
export const ChevronRightIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// 下拉箭头图标
export const ChevronDownIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// 切换目录图标：上层向左箭头 + 下层向右箭头
export const SwitchDirectoryIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 5 5 9h13" />
    <path d="M5 15h14l-4 4" />
  </svg>
);

// Switch 图标 - 左右箭头（无横线，更简洁）
export const SwitchArrowsIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 16l-4-4 4-4" />
    <path d="M17 8l4 4-4 4" />
  </svg>
);

// Switch 图标 - 交换/互换（两箭头交叉）
export const SwitchSwapIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 3l4 4-4 4" />
    <path d="M20 7H8" />
    <path d="M8 21l-4-4 4-4" />
    <path d="M4 17h12" />
  </svg>
);

// Switch 图标 - 上下交换
export const SwitchVerticalIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 8l-4-4-4 4" />
    <path d="M7 16l4 4 4-4" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </svg>
);

// Switch 图标 - 旋转 180°（翻转）
export const SwitchRotateIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 119 9 9 9 0 01-2.6-6.4" />
    <path d="M21 12a9 9 0 11-9-9 9 9 0 012.6 6.4" />
    <path d="M8 16l4-4 4 4" />
    <path d="M12 12v8" />
  </svg>
);

// Switch 图标 - 双向箭头（细线）
export const SwitchBidirectionalIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14" />
    <path d="M12 5l4 4-4 4" />
    <path d="M12 19l-4-4 4-4" />
  </svg>
);

// Switch 图标 - 左右块互换（两个矩形+箭头）
export const SwitchBlocksIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="6" width="6" height="4" rx="1" />
    <rect x="16" y="14" width="6" height="4" rx="1" />
    <path d="M10 8h2l2-2 2 2h2" />
    <path d="M14 16h-2l-2 2-2-2h-2" />
  </svg>
);

// Switch 图标 - 上下双箭头（上左、下右，交换/双向）
export const SwitchTwoArrowsIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* 上：向左箭头 */}
    <polyline points="18 8 8 8" />
    <polyline points="8 8 6 6" />
    <polyline points="8 8 6 10" />
    {/* 下：向右箭头 */}
    <polyline points="6 16 16 16" />
    <polyline points="16 16 18 14" />
    <polyline points="16 16 18 18" />
  </svg>
);

// 文件图标
export const FileIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

// 文档图标
export const DocumentIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg className={className} viewBox="0 0 512 512" fill="currentColor">
    <path d="m433.798 106.268-96.423-91.222c-10.256-9.703-23.68-15.046-37.798-15.046h-183.577c-30.327 0-55 24.673-55 55v402c0 30.327 24.673 55 55 55h280c30.327 0 55-24.673 55-55v-310.778c0-15.049-6.27-29.612-17.202-39.954zm-29.137 13.732h-74.661c-2.757 0-5-2.243-5-5v-70.364zm-8.661 362h-280c-13.785 0-25-11.215-25-25v-402c0-13.785 11.215-25 25-25h179v85c0 19.299 15.701 35 35 35h91v307c0 13.785-11.215 25-25 25z" />
    <path d="m363 200h-220c-8.284 0-15 6.716-15 15s6.716 15 15 15h220c8.284 0 15-6.716 15-15s-6.716-15-15-15z" />
    <path d="m363 280h-220c-8.284 0-15 6.716-15 15s6.716 15 15 15h220c8.284 0 15-6.716 15-15s-6.716-15-15-15z" />
    <path d="m215.72 360h-72.72c-8.284 0-15 6.716-15 15s6.716 15 15 15h72.72c8.284 0 15-6.716 15-15s-6.716-15-15-15z" />
  </svg>
);

// 文件夹图标
export const FolderIcon = ({ className = 'w-4 h-4', open }: IconProps & { open?: boolean }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {open ? (
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v2M2 10h20M22 10l-2 9H4l-2-9" />
    ) : (
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    )}
  </svg>
);

// 发送图标
export const SendIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

// 发送图标 - 向上箭头 (圆圈内)
export const SendArrowIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16V8" />
    <path d="M8 12l4-4 4 4" />
  </svg>
);

// 发送图标 - 极简向上箭头
export const SendArrowSimpleIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 19V5" />
    <path d="M5 12l7-7 7 7" />
  </svg>
);

// 发送图标 - 填充风格 (实心)
export const SendFillIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

// 发送图标 - Return/Enter 回车键
export const SendReturnIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 7v4a2 2 0 01-2 2H7" />
    <polyline points="10 16 7 13 10 10" />
  </svg>
);

// 停止图标
export const StopIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

// 更多选项图标 (三个点竖排)
export const MoreIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="5" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </svg>
);

// 更多选项图标 (三个点横排)
export const MoreHorizontalIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
  </svg>
);

// Messenger 侧边栏图标 - 纸飞机
export const MessengerIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 2 11 13" />
    <path d="m22 2-7 20-4-9-9-4 20-7Z" />
  </svg>
);

// 复制图标
export const CopyIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

// 粘贴图标
export const PasteIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
  </svg>
);

// 删除/垃圾桶图标
export const TrashIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" />
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export const EditIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

// 表格图标
export const TableIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" />
  </svg>
);

// 列表图标 (Task List)
export const ListIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

// 代码块图标
export const CodeBlockIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

// Mermaid 图标 (流程图)
export const MermaidIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="15" y="15" width="6" height="6" rx="1" />
    <path d="M6 9v3a3 3 0 003 3h3" />
    <path d="M12 15h3a3 3 0 013 3v0" />
    <path d="M15 6h2a3 3 0 013 3v3" />
  </svg>
);

// 行号图标 (显示状态 - 睁眼)
export const LineNumbersIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

// 行号隐藏图标 (隐藏状态 - 闭眼)
export const LineNumbersOffIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

// 默认导出 AgentBaguaIcon 作为 AgentsIcon / LiIcon (离卦 ☲)
export const LiIcon = AgentBaguaIcon;
export const AgentsIcon = AgentBaguaIcon;

// 首页图标
export const HomeIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

// 窗口图标
export const AppWindowIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

export const SkillPuzzleIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 4h4v3a2 2 0 1 0 4 0V4h2a2 2 0 0 1 2 2v4h-3a2 2 0 1 0 0 4h3v4a2 2 0 0 1-2 2h-4v-3a2 2 0 1 0-4 0v3H6a2 2 0 0 1-2-2v-4h3a2 2 0 1 0 0-4H4V6a2 2 0 0 1 2-2h2z" />
  </svg>
);

export const ToolsIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

export const ClockIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const HistoryIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </svg>
);

export const TasksIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M13 5h8" />
    <path d="M13 12h8" />
    <path d="M13 19h8" />
    <path d="m3 7 2 2 4-4" />
    <path d="m3 14 2 2 4-4" />
  </svg>
);

// 主题/画笔图标
export const PaintBrushIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z" />
    <path d="M8 18l-6 2 2-6" />
  </svg>
);

// 用户图标
export const UserIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

// 远程/服务器图标
export const RemoteIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </svg>
);

// ========== 补充实用图标 ==========

// 纸飞机图标 - 发送消息的标准语义
export const PaperPlaneIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 2L11 13" />
    <path d="M22 2L15 22l-4-9-9-4 20-7z" />
  </svg>
);

// 纸飞机图标 - 填充版
export const PaperPlaneFillIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

// AI/智能闪光图标 - Sparkle
export const SparkleIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6l2.1-2.1" />
    <circle cx="12" cy="12" r="4" />
  </svg>
);

// AI/智能闪光图标 - 四角星
export const SparkleStarIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" />
  </svg>
);

// 重新生成图标 - 带箭头的刷新
export const RegenerateIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 01-15.74 5.74" />
  </svg>
);

// 复制成功图标 - 勾 + 文档
export const CopyCheckIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    <path d="M12 15l2 2 4-4" />
  </svg>
);

// 成功/勾选图标
export const CheckIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// 成功图标 - 圆形带勾
export const CheckCircleIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

// 错误/警告图标 - 圆形带叹号
export const AlertCircleIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

// 加载中图标 - 旋转用
export const LoaderIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
);

// ========== 小尺寸优化版本 (Tiny) ==========

// 关闭图标 - 小尺寸优化 (10-12px 友好)
export const CloseTinyIcon = ({ className = 'w-3 h-3' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <line x1="3" y1="3" x2="9" y2="9" />
    <line x1="9" y1="3" x2="3" y2="9" />
  </svg>
);

// 勾选图标 - 小尺寸优化
export const CheckTinyIcon = ({ className = 'w-3 h-3' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="2.5 6 5 8.5 9.5 3.5" />
  </svg>
);

// 箭头向上图标 - 小尺寸发送按钮
export const ArrowUpTinyIcon = ({ className = 'w-3 h-3' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 9V3" />
    <path d="M3 6l3-3 3 3" />
  </svg>
);

// ========== 收起/展开 (区分语义) ==========

// 收起图标 - Collapse
export const CollapseIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// 展开图标 - Expand
export const ExpandIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 15 12 9 18 15" />
  </svg>
);

/**
 * Cursor-style primary-sidebar toggle: outlined rounded frame with a left pane divider.
 * Same glyph for both collapse and expand.
 */
export const SidebarPanelToggleIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" />
    <line x1="5.75" y1="2.25" x2="5.75" y2="13.75" />
  </svg>
);

// ========== Search 专用 ==========

// 区分大小写：Aa
export const CaseSensitiveIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <text x="3" y="17" fontSize="13" fontFamily="system-ui, sans-serif" fontWeight="600">A</text>
    <text x="12" y="17" fontSize="10" fontFamily="system-ui, sans-serif" fontWeight="500">a</text>
  </svg>
);

// 全字匹配：abc 加下划线
export const WholeWordIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <text x="3" y="15" fontSize="10" fontFamily="system-ui, sans-serif" fontWeight="700" fill="currentColor" stroke="none">ab</text>
    <line x1="3" y1="19" x2="21" y2="19" />
  </svg>
);

// 正则：.*
export const RegexIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 4v8" />
    <path d="M8.5 6l7 4" />
    <path d="M15.5 6l-7 4" />
    <circle cx="6" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
);

// 过滤：漏斗
export const FilterIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 5h18l-7 9v6l-4-2v-4z" />
  </svg>
);

// 替换：箭头交换
export const ReplaceIcon = ({ className = 'w-4 h-4' }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 7h11l-3-3M4 7l3 3" />
    <path d="M20 17H9l3 3M20 17l-3-3" />
  </svg>
);

type CloseButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  title?: string;
  className?: string;
  variant?: IconButtonVariant;
};

export const CloseButton: React.FC<CloseButtonProps> = ({ onClick, title = 'Close', className = '', variant = 'toolbar', ...rest }) => (
  <IconButton className={className} variant={variant} onClick={onClick} title={title} {...rest}>
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  </IconButton>
);
