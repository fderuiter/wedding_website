import theme from '../theme'

describe('theme', () => {
  it('has expected primary and secondary colors', () => {
    expect(theme.colors.primary).toBe('#f43f5e')
    expect(theme.colors.secondary).toBe('#fbbf24')
  })

  it('defines gradients', () => {
    expect(theme.gradients.primary).toBeDefined()
    expect(theme.gradients.background).toBeDefined()
  })
})
