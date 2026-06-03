import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { extractHtmlFile } from '../html';

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname_, '../../../../../tests/fixtures/file-search/sample.html');

describe('extractHtmlFile', () => {
  it('strips HTML tags and returns body text', async () => {
    const size = statSync(FIXTURE).size;
    const r = await extractHtmlFile(FIXTURE, size);
    expect(r.format).toBe('html');
    expect(r.text).toContain('Quarterly');
    expect(r.text).toContain('Revenue numbers');
    expect(r.text).not.toContain('<h1>');
  });
});
