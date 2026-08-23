import { describe, expect, it } from 'vitest'
import { botColor, hueOf } from './BotAvatar'

describe('a Bot face', () => {
  it('reads a chosen colour as a hue, and ignores anything that is not one', () => {
    // Blobatar takes a hue and derives its own palette, so honouring someone's colour means
    // handing over the hue rather than overriding the fill.
    expect(hueOf('#ff0000')).toBe(0)
    expect(hueOf('#00ff00')).toBe(120)
    expect(hueOf('#0000ff')).toBe(240)
    expect(hueOf('5b4bc4')).toBe(248) // the leading # is optional
    expect(hueOf('#808080')).toBe(0) // grey has no hue; 0 is as good as any
    // Not a colour: fall back to the seeded palette rather than guessing.
    expect(hueOf(undefined)).toBeNull()
    expect(hueOf('')).toBeNull()
    expect(hueOf('rebeccapurple')).toBeNull()
    expect(hueOf('#abc')).toBeNull()
  })

  it('gives the same Bot the same colour every time, and a chosen one wins', () => {
    expect(botColor({ id: 'abc12345' })).toBe(botColor({ id: 'abc12345' }))
    expect(botColor({ id: 'abc12345', color: '#123456' })).toBe('#123456')
  })
})
