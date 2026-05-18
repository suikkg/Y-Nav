import { describe, it, expect } from 'vitest';
import {
  detectPlaceholders,
  substituteVariables,
} from '../src/components/scripts/CopyWithVarsButton';

describe('detectPlaceholders', () => {
  it('detects ${VAR} placeholders with uppercase names', () => {
    const r = detectPlaceholders('echo ${USER_NAME}');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'USER_NAME', hasDollar: true, hasMustache: false });
  });

  it('does NOT pick up lowercase ${var} (avoids false positives in shell)', () => {
    const r = detectPlaceholders('echo ${HOME} && cd ${user}');
    expect(r.map((p) => p.name)).toEqual(['HOME']);
  });

  it('requires at least 2 chars in ${VAR} name (filter single-letter shell vars)', () => {
    const r = detectPlaceholders('${X} ${YZ}');
    expect(r.map((p) => p.name)).toEqual(['YZ']);
  });

  it('detects {{name}} placeholders', () => {
    const r = detectPlaceholders('hello {{first_name}} and {{last}}');
    expect(r.map((p) => p.name).sort()).toEqual(['first_name', 'last']);
    expect(r.every((p) => p.hasMustache && !p.hasDollar)).toBe(true);
  });

  it('marks both forms when same name appears as both ${X} and {{X}}', () => {
    const r = detectPlaceholders('${NAME} ... {{NAME}}');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'NAME', hasDollar: true, hasMustache: true });
  });

  it('deduplicates repeated placeholders', () => {
    const r = detectPlaceholders('${AA} ${AA} ${AA} {{bb}} {{bb}}');
    expect(r).toHaveLength(2);
    expect(r.map((p) => p.name).sort()).toEqual(['AA', 'bb']);
  });

  it('returns empty for code without placeholders', () => {
    expect(detectPlaceholders('echo hello world')).toEqual([]);
  });
});

describe('substituteVariables', () => {
  it('replaces ${NAME} with provided value', () => {
    expect(substituteVariables('hello ${NAME}', { NAME: 'world' })).toBe('hello world');
  });

  it('replaces {{name}} with provided value (allows whitespace)', () => {
    expect(substituteVariables('hello {{name}}', { name: 'world' })).toBe('hello world');
    expect(substituteVariables('hello {{ name }}', { name: 'world' })).toBe('hello world');
  });

  it('replaces all occurrences globally', () => {
    expect(substituteVariables('${AA}-${AA}-${AA}', { AA: 'x' })).toBe('x-x-x');
  });

  it('handles regex metachars in NAME safely', () => {
    // names with hyphens are valid mustache; ensure no regex injection
    const code = '{{user-id}} and {{user-id}}';
    expect(substituteVariables(code, { 'user-id': '42' })).toBe('42 and 42');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(substituteVariables('${AA} ${BB}', { AA: 'x' })).toBe('x ${BB}');
  });

  it('handles empty values gracefully', () => {
    expect(substituteVariables('start${XX}end', { XX: '' })).toBe('startend');
  });
});
