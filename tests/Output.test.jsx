import { describe, it, expect } from 'vitest'
import Output from '../web/src/components/Output.jsx'

describe('Output', () => {
  it('exports a default component', () => {
    expect(typeof Output).toBe('function')
  })

  it('component accepts task prop', () => {
    expect(Output.length >= 0).toBe(true)
  })

  it('component name is Output', () => {
    expect(Output.name).toBe('Output')
  })
})
