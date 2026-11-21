/**
 * The blog's own wording, in both languages.
 *
 * It lives outside the components because two places need it: the page renders
 * these strings, and `siteMetadata.ts` builds the `<title>`, description and
 * social card from the same words. A second copy would let the page and its card
 * drift apart.
 *
 * @module hulala/website/blog/copy
 */
import type { BlogLocale } from './posts'

export const blogCopy = {
  en: {
    label: 'BLOG',
    title: ['What changed,', 'and what it is for.'],
    metaTitle: 'Hulala blog — what changed, and what it is for',
    lede: 'One post per release: what this version is worth to the person using it, why it was built this way, and what it is for. The changelog lists the changes; this is where we explain them.',
    metaDescription:
      'One post per release: what this version is worth to the person using it, why it was built this way, and what it is for.',
    listAria: 'Release posts, newest first',
    empty: 'The first release post is being written. The changelog is up to date in the meantime.',
    read: 'Read the post',
    release: 'RELEASE',
    back: 'All posts',
    install: 'Install Hulala',
    breadcrumbAria: 'Breadcrumb',
    more: 'Earlier releases',
    moreAria: 'Earlier release posts',
    navAria: 'Primary navigation',
    home: 'Home',
    blog: 'Blog',
    download: 'Download',
    githubLabel: 'GitHub',
    githubAria: 'Open the Hulala repository on GitHub',
    footerSlogan: 'Hulala — the local agent that outlives your terminal window.',
    footer: 'Terminal · macOS & Linux',
  },
  'zh-CN': {
    label: '博客',
    title: ['这次改了什么，', '又是为了什么。'],
    metaTitle: 'Hulala 博客｜每次发布，改了什么、为什么、有什么用',
    lede: '每次发布一篇：这个版本对用它的人有什么价值，为什么这样设计，它是拿来做什么的。CHANGELOG 负责列出改动，这里负责把改动讲清楚。',
    metaDescription: '每次发布一篇：这个版本对用它的人有什么价值，为什么这样设计，它是拿来做什么的。',
    listAria: '发布文章，最新的在前',
    empty: '第一篇发版文章正在写。这段时间可以先看 CHANGELOG。',
    read: '读这篇',
    release: '版本',
    back: '全部文章',
    install: '安装 Hulala',
    breadcrumbAria: '面包屑导航',
    more: '往期发布',
    moreAria: '往期发版文章',
    navAria: '主要导航',
    home: '首页',
    blog: '博客',
    download: '下载',
    githubLabel: 'GitHub',
    githubAria: '在 GitHub 上打开 Hulala 仓库',
    footerSlogan: '呼啦啦——关掉窗口也还在跑的本地 Agent。',
    footer: '终端 · macOS 与 Linux',
  },
} as const satisfies Record<BlogLocale, unknown>
