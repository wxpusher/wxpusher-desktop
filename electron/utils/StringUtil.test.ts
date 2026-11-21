// 运行：npm run test:unit（Node 22 自带 node:test + 类型剥离，不依赖 Electron 和 node_modules）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import StringUtil from './StringUtil.ts';

test('不超长时原样返回', () => {
  assert.equal(StringUtil.getStringLessLength('', 3), '');
  assert.equal(StringUtil.getStringLessLength('abc', 3), 'abc');
});

test('超长时按 UTF-16 长度截断', () => {
  assert.equal(StringUtil.getStringLessLength('abc', 2), 'ab');
  assert.equal(StringUtil.getStringLessLength('你好世界', 2), '你好');
});

test('切点落在 emoji 中间时往前退一位', () => {
  assert.equal(StringUtil.getStringLessLength('a😀b', 2), 'a');
  assert.equal(StringUtil.getStringLessLength('a😀b', 3), 'a😀');
  assert.equal(StringUtil.getStringLessLength('😀', 1), '');
});

test('系统通知正文截到 100 时不留下半个 emoji', () => {
  const summary = 'a'.repeat(99) + '😀tail';
  assert.equal(StringUtil.getStringLessLength(summary, 100), 'a'.repeat(99));
});
