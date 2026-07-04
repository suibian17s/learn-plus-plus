import { describe, it, expect } from 'vitest'
import { sanitizeFilename } from '../main/utils/sanitize'

describe('sanitizeFilename', () => {
  it('strips characters illegal on Windows', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeFilename('  name  ')).toBe('name')
  })

  it('preserves CJK and dots', () => {
    expect(sanitizeFilename('课件 第3章.pdf')).toBe('课件 第3章.pdf')
  })

  it('handles empty input', () => {
    expect(sanitizeFilename('')).toBe('')
  })
})