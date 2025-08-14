import theme from '../theme'

describe('theme', () => {
  it('has expected primary and secondary colors', () => {
    expect(theme.colors.primary).toBe('#B91C1C')
    expect(theme.colors.secondary).toBe('#B8860B')
  })

  it('defines gradients', () => {
    expect(theme.gradients.primary).toBeDefined()
    expect(theme.gradients.background).toBeDefined()
  })
})
