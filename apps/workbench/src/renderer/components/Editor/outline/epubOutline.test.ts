import assert from 'node:assert/strict';
import test from 'node:test';
import type { NavItem } from 'epubjs';

import {
  buildEpubOutlineNodes,
  findActiveEpubOutlineId,
  normalizeEpubHref,
} from './epubOutline.ts';
import { filterVisibleOutlineNodes } from './outlineExpand.ts';

test('preserves nested NavItem depth and keeps children collapsed by default', () => {
  const toc: NavItem[] = [
    {
      id: 'mencius',
      href: 'Text/mencius.xhtml',
      label: '孟子',
      subitems: [
        { id: 'cover', href: 'Text/cover.xhtml', label: '封面', subitems: [] },
        {
          id: 'book1',
          href: 'Text/book1.xhtml',
          label: '梁惠王上',
          subitems: [
            { id: 'ch1', href: 'Text/book1.xhtml#ch1', label: '第一章', subitems: [] },
          ],
        },
      ],
    },
    { id: 'xunzi', href: 'Text/xunzi.xhtml', label: '荀子', subitems: [] },
  ];

  const nodes = buildEpubOutlineNodes(toc);
  assert.equal(nodes.length, 5);
  assert.equal(nodes[0].label, '孟子');
  assert.equal(nodes[0].hasChildren, true);
  assert.equal(nodes[1].depth, 1);
  assert.equal(nodes[2].depth, 1);
  assert.equal(nodes[3].depth, 2);
  assert.equal(nodes[3].ancestorIds.includes(nodes[0].id), true);
  assert.equal(nodes[3].ancestorIds.includes(nodes[2].id), true);

  const visible = filterVisibleOutlineNodes(nodes, new Set());
  assert.deepEqual(visible.map((node) => node.label), ['孟子', '荀子']);
});

test('matches active TOC id by href path and prefers deeper exact fragment', () => {
  const nodes = buildEpubOutlineNodes([
    {
      id: 'book1',
      href: 'Text/book1.xhtml',
      label: 'Book',
      subitems: [
        { id: 'ch1', href: 'Text/book1.xhtml#ch1', label: 'Chapter 1', subitems: [] },
        { id: 'ch2', href: 'Text/book1.xhtml#ch2', label: 'Chapter 2', subitems: [] },
      ],
    },
  ]);

  assert.equal(normalizeEpubHref('./Text/book1.xhtml#ch2'), 'text/book1.xhtml#ch2');
  assert.equal(findActiveEpubOutlineId(nodes, 'Text/book1.xhtml#ch2'), nodes[2].id);
  assert.equal(findActiveEpubOutlineId(nodes, 'Text/book1.xhtml'), nodes[0].id);
});

test('produces unique ids even when NavItem ids repeat', () => {
  const nodes = buildEpubOutlineNodes([
    { id: 'dup', href: 'Text/a.xhtml', label: 'A', subitems: [] },
    { id: 'dup', href: 'Text/b.xhtml', label: 'B', subitems: [] },
  ]);
  assert.notEqual(nodes[0].id, nodes[1].id);
});

test('recovers part and numbered chapter hierarchy from a fully-flat NCX TOC', () => {
  const nodes = buildEpubOutlineNodes([
    { id: 'preface', href: 'preface.xhtml', label: '总序言', subitems: [] },
    { id: 'part1', href: 'part1.xhtml', label: '第一部分 背景', subitems: [] },
    { id: 'p1-1', href: 'p1_1.xhtml', label: '1 爱产品，恨企业', subitems: [] },
    { id: 'p1-2', href: 'p1_2.xhtml', label: '2 制药的历史', subitems: [] },
    { id: 'part2', href: 'part2.xhtml', label: '第二部分 商业简史', subitems: [] },
    { id: 'p2-1', href: 'p2_1.xhtml', label: '1 机械的企业思维与管理', subitems: [] },
  ]);

  assert.deepEqual(nodes.map((node) => node.depth), [0, 0, 1, 1, 0, 1]);
  assert.equal(nodes[1].hasChildren, true);
  assert.equal(nodes[2].parentId, nodes[1].id);
  assert.equal(nodes[5].parentId, nodes[4].id);
  assert.deepEqual(
    filterVisibleOutlineNodes(nodes, new Set()).map((node) => node.label),
    ['总序言', '第一部分 背景', '第二部分 商业简史'],
  );
});

test('recovers three levels from flat part and decimal-number labels', () => {
  const nodes = buildEpubOutlineNodes([
    { id: 'part', href: 'part.xhtml', label: '第一部分 背景', subitems: [] },
    { id: 'chapter', href: 'chapter.xhtml', label: '1 公司', subitems: [] },
    { id: 'section', href: 'section.xhtml', label: '1.1 起源', subitems: [] },
  ]);

  assert.deepEqual(nodes.map((node) => node.depth), [0, 1, 2]);
  assert.equal(nodes[0].hasChildren, true);
  assert.equal(nodes[1].hasChildren, true);
  assert.deepEqual(nodes[2].ancestorIds, [nodes[0].id, nodes[1].id]);
});

test('recovers chapter children from flat plain-title EPUB3 nav siblings', () => {
  const nodes = buildEpubOutlineNodes([
    { id: 'cover', href: '0001.xhtml', label: '封面', subitems: [] },
    { id: 'ch1', href: '0010.xhtml', label: '第1章 价值投资：定义、区别、结果、风险与原则', subitems: [] },
    { id: 's1', href: '0011.xhtml', label: '价值投资的定义', subitems: [] },
    { id: 's2', href: '0012.xhtml', label: '什么不是价值投资', subitems: [] },
    { id: 'appendix', href: '0015.xhtml', label: '附录 超额回报是对承担额外风险的回报吗', subitems: [] },
    { id: 'ch2', href: '0016.xhtml', label: '第2章 寻找价值：在交易中处在有利位置', subitems: [] },
    { id: 's3', href: '0017.xhtml', label: '专业化', subitems: [] },
    { id: 'thanks', href: '0084.xhtml', label: '致谢', subitems: [] },
    { id: 'translator', href: '0085.xhtml', label: '译者后记', subitems: [] },
  ]);

  assert.deepEqual(
    nodes.map((node) => node.depth),
    [0, 0, 1, 1, 1, 0, 1, 0, 0],
  );
  assert.equal(nodes[1].hasChildren, true);
  assert.equal(nodes[2].parentId, nodes[1].id);
  assert.equal(nodes[4].parentId, nodes[1].id);
  assert.equal(nodes[6].parentId, nodes[5].id);
  assert.equal(nodes[7].hasChildren, false);
  assert.deepEqual(
    filterVisibleOutlineNodes(nodes, new Set()).map((node) => node.label),
    [
      '封面',
      '第1章 价值投资：定义、区别、结果、风险与原则',
      '第2章 寻找价值：在交易中处在有利位置',
      '致谢',
      '译者后记',
    ],
  );
});
