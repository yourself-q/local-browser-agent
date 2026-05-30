import { describe, test, expect } from 'vitest';
import { CustomToolSchema, escapeForJSString, renderJsTemplate } from '../tools/custom.js';

// ─── Schema validation ────────────────────────────────────────────────────────

describe('CustomToolSchema', () => {
  const validTool = {
    name: 'fill_company_field',
    description: 'Fill the company name field with the given value',
    jsTemplate: "document.querySelector('#company').value = '${value}';",
  };

  test('accepts a valid tool definition', () => {
    expect(() => CustomToolSchema.parse(validTool)).not.toThrow();
  });

  test('rejects name with uppercase letters', () => {
    expect(() => CustomToolSchema.parse({ ...validTool, name: 'FillField' })).toThrow();
  });

  test('rejects name starting with a number', () => {
    expect(() => CustomToolSchema.parse({ ...validTool, name: '1fill' })).toThrow();
  });

  test('rejects name with spaces', () => {
    expect(() => CustomToolSchema.parse({ ...validTool, name: 'fill field' })).toThrow();
  });

  test('accepts name with underscores and numbers', () => {
    expect(() => CustomToolSchema.parse({ ...validTool, name: 'fill_field_2' })).not.toThrow();
  });

  test('rejects name longer than 50 chars', () => {
    const longName = 'a' + '_'.repeat(50);
    expect(() => CustomToolSchema.parse({ ...validTool, name: longName })).toThrow();
  });

  test('rejects empty description', () => {
    expect(() => CustomToolSchema.parse({ ...validTool, description: '' })).toThrow();
  });

  test('rejects empty jsTemplate', () => {
    expect(() => CustomToolSchema.parse({ ...validTool, jsTemplate: '' })).toThrow();
  });
});

// ─── escapeForJSString ────────────────────────────────────────────────────────

describe('escapeForJSString', () => {
  test('escapes single quotes', () => {
    expect(escapeForJSString("it's")).toBe("it\\'s");
  });

  test('escapes double quotes', () => {
    expect(escapeForJSString('say "hello"')).toBe('say \\"hello\\"');
  });

  test('escapes backticks', () => {
    expect(escapeForJSString('`template`')).toBe('\\`template\\`');
  });

  test('escapes backslashes', () => {
    expect(escapeForJSString('C:\\Users')).toBe('C:\\\\Users');
  });

  test('escapes newlines', () => {
    expect(escapeForJSString('line1\nline2')).toBe('line1\\nline2');
  });

  test('escapes angle brackets (XSS guard)', () => {
    expect(escapeForJSString('<script>')).toBe('\\x3cscript\\x3e');
  });

  test('passes through normal alphanumeric text unchanged', () => {
    expect(escapeForJSString('hello world 123')).toBe('hello world 123');
  });

  test('handles empty string', () => {
    expect(escapeForJSString('')).toBe('');
  });
});

// ─── renderJsTemplate ─────────────────────────────────────────────────────────

describe('renderJsTemplate', () => {
  test('substitutes ${value} with the escaped value', () => {
    const template = "document.querySelector('#name').value = '${value}';";
    const result = renderJsTemplate(template, 'Acme Corp');
    expect(result).toBe("document.querySelector('#name').value = 'Acme Corp';");
  });

  test('escapes special chars in the substituted value', () => {
    const template = "el.value = '${value}';";
    const result = renderJsTemplate(template, "O'Brien");
    expect(result).toBe("el.value = 'O\\'Brien';");
  });

  test('replaces all occurrences of ${value}', () => {
    const template = "console.log('${value}'); el.value = '${value}';";
    const result = renderJsTemplate(template, 'test');
    expect(result).toBe("console.log('test'); el.value = 'test';");
  });

  test('handles empty value', () => {
    const template = "el.value = '${value}';";
    expect(renderJsTemplate(template, '')).toBe("el.value = '';");
  });

  test('leaves templates without ${value} unchanged', () => {
    const template = "document.querySelector('#btn').click();";
    expect(renderJsTemplate(template, 'ignored')).toBe(template);
  });

  test('prevents JS injection via value — single quote is escaped', () => {
    const template = "el.value = '${value}';";
    // Attempt to close the string and inject a new statement
    const malicious = "'; alert(1); var x='";
    const result = renderJsTemplate(template, malicious);
    // All single quotes in the value must be escaped as \'
    expect(result).toContain("\\'");
    // The full output should be one safe assignment where the value is quoted
    expect(result).toBe("el.value = '\\'; alert(1); var x=\\'';");
  });
});
