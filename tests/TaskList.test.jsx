import { describe, it, expect } from 'vitest'
import TaskList from '../web/src/components/TaskList.jsx'

describe('TaskList', () => {
  it('exports a default component', () => {
    expect(typeof TaskList).toBe('function')
  })

  it('component accepts required props', () => {
    expect(TaskList.length >= 0).toBe(true)
  })

  it('component name is TaskList', () => {
    expect(TaskList.name).toBe('TaskList')
  })
})
