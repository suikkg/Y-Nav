import React, { useMemo } from 'react';

interface HighlightTextProps {
  text: string;
  /** 待匹配的关键词。支持空格分多个 token，全部不区分大小写。 */
  query?: string;
  className?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把命中关键词包成 <mark>。
 * 多 token：按空格切分后取并集；单 token 也走同样路径。
 * 性能：每段文字独立编译一次正则，足够轻量；只在出现匹配时分段渲染。
 */
const HighlightText: React.FC<HighlightTextProps> = ({ text, query, className }) => {
  const segments = useMemo(() => {
    if (!query || !text) return null;
    const tokens = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(escapeRegExp);
    if (tokens.length === 0) return null;
    const re = new RegExp(`(${tokens.join('|')})`, 'gi');
    const parts = text.split(re);
    let hasMatch = false;
    for (let i = 1; i < parts.length; i += 2) {
      if (parts[i]) {
        hasMatch = true;
        break;
      }
    }
    if (!hasMatch) return null;
    return parts;
  }, [text, query]);

  if (!segments) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {segments.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="bg-amber-200/70 dark:bg-amber-400/30 text-inherit rounded px-0.5"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </span>
  );
};

export default HighlightText;
