import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HighlightText from '../src/components/scripts/HighlightText';

describe('<HighlightText>', () => {
  it('renders plain text when query is empty', () => {
    render(<HighlightText text="hello world" />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
    expect(document.querySelectorAll('mark')).toHaveLength(0);
  });

  it('wraps single-token match in <mark> (case-insensitive)', () => {
    render(<HighlightText text="Hello World" query="hello" />);
    const marks = document.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('Hello');
  });

  it('matches multiple tokens (whitespace-separated)', () => {
    render(<HighlightText text="alpha beta gamma" query="alpha gamma" />);
    const marks = Array.from(document.querySelectorAll('mark'));
    expect(marks.map((m) => m.textContent)).toEqual(['alpha', 'gamma']);
  });

  it('escapes regex metacharacters in the query', () => {
    render(<HighlightText text="2 + 3 = 5" query="+" />);
    const marks = document.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('+');
  });

  it('returns plain text when no match found', () => {
    render(<HighlightText text="hello" query="xyz" />);
    expect(document.querySelectorAll('mark')).toHaveLength(0);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('handles overlapping but distinct tokens', () => {
    render(<HighlightText text="docker dockerfile" query="docker" />);
    const marks = Array.from(document.querySelectorAll('mark'));
    expect(marks.map((m) => m.textContent)).toEqual(['docker', 'docker']);
  });
});
