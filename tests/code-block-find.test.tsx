import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// jsdom 没实现 scrollIntoView，需要 stub
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// shiki 在 jsdom 下太重，mock 掉，输出最小可用的 line 包裹结构
vi.mock('../src/components/scripts/highlight', () => ({
  highlightCodeAsync: async (code: string, language?: string) => ({
    html: code
      .split('\n')
      .map((line) => `<span class="line">${line.replace(/</g, '&lt;')}</span>`)
      .join('\n'),
    language: (language || 'text').toLowerCase(),
  }),
  highlightCode: (code: string, language?: string) => ({
    html: code,
    language: (language || 'text').toLowerCase(),
  }),
}));

// CopyWithVarsButton 引入了变量解析逻辑、与查找无关
vi.mock('../src/components/scripts/CopyWithVarsButton', () => ({
  default: () => null,
}));

import CodeBlock from '../src/components/scripts/CodeBlock';

const code = [
  'import asyncio',
  'import json',
  'def make_request():',
  '    return request',
  'class RequestHandler:',
  '    pass',
  'send_request()',
].join('\n');

async function openFindAndType(query: string) {
  const findBtn = screen.getByRole('button', { name: /查找/i });
  fireEvent.click(findBtn);
  // requestAnimationFrame 内 focus
  await new Promise((r) => requestAnimationFrame(r));
  const input = screen.getByPlaceholderText('查找...') as HTMLInputElement;
  fireEvent.change(input, { target: { value: query } });
  // 等 useEffect 跑完
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return input;
}

describe('<CodeBlock> 查找', () => {
  it('一次性贴入 query 时 marks 数量正确 + 第一个标 active', async () => {
    render(<CodeBlock code={code} language="python" showLineNumbers />);
    // 等 highlightCodeAsync 异步刷新 highlightedHtml
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await openFindAndType('request');
    const marks = document.querySelectorAll('mark.ynav-code-find');
    expect(marks.length).toBeGreaterThan(0);
    const active = document.querySelectorAll('mark.ynav-code-find.ynav-code-find--active');
    expect(active.length).toBe(1);
    expect(active[0]).toBe(marks[0]);
  });

  it('逐字输入 query 时第一个仍然能拿到 active 样式', async () => {
    render(<CodeBlock code={code} language="python" showLineNumbers />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const findBtn = screen.getByRole('button', { name: /查找/i });
    fireEvent.click(findBtn);
    await new Promise((r) => requestAnimationFrame(r));
    const input = screen.getByPlaceholderText('查找...') as HTMLInputElement;

    for (const ch of 'request') {
      const current = input.value + ch;
      fireEvent.change(input, { target: { value: current } });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    const marks = document.querySelectorAll('mark.ynav-code-find');
    expect(marks.length).toBeGreaterThan(0);
    const active = document.querySelectorAll('mark.ynav-code-find.ynav-code-find--active');
    expect(active.length).toBe(1);
    expect(active[0]).toBe(marks[0]);
  });

  it('点击"下一个"按钮时 active 移到下一个 mark', async () => {
    render(<CodeBlock code={code} language="python" showLineNumbers />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await openFindAndType('request');
    const marks = document.querySelectorAll('mark.ynav-code-find');
    expect(marks.length).toBeGreaterThanOrEqual(2);

    const nextBtn = screen.getByRole('button', { name: /下一个/ });
    fireEvent.click(nextBtn);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const active = document.querySelectorAll('mark.ynav-code-find.ynav-code-find--active');
    expect(active.length).toBe(1);
    expect(active[0]).toBe(marks[1]);

    // 再点回上一个
    const prevBtn = screen.getByRole('button', { name: /上一个/ });
    fireEvent.click(prevBtn);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const active2 = document.querySelectorAll('mark.ynav-code-find.ynav-code-find--active');
    expect(active2.length).toBe(1);
    expect(active2[0]).toBe(marks[0]);
  });
});
