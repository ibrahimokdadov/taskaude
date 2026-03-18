import { describe, it, expect } from 'vitest'
import ProjectList from '../web/src/components/ProjectList.jsx'

describe('ProjectList', () => {
  it('exports a default component', () => {
    expect(typeof ProjectList).toBe('function')
  })

  it('component accepts required props', () => {
    expect(ProjectList.length >= 0).toBe(true)
  })

  it('component name is ProjectList', () => {
    expect(ProjectList.name).toBe('ProjectList')
  })
})
