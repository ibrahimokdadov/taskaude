import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { TaskList } from '../src/components/TaskList.jsx'

const mockTasks = [
  { id: 'abc123', status: 'running', elapsed: '1m 30s' },
  { id: 'def456', status: 'done', elapsed: '0m 45s' },
  { id: 'ghi789', status: 'failed', elapsed: '0m 12s' },
]

describe('TaskList', () => {
  it('renders task IDs', () => {
    const { lastFrame } = render(
      <TaskList tasks={mockTasks} selectedIndex={0} focused={true} width={30} />
    )
    expect(lastFrame()).toContain('abc123')
    expect(lastFrame()).toContain('def456')
    expect(lastFrame()).toContain('ghi789')
  })

  it('renders status icons', () => {
    const { lastFrame } = render(
      <TaskList tasks={mockTasks} selectedIndex={0} focused={true} width={30} />
    )
    expect(lastFrame()).toContain('⦿') // running
    expect(lastFrame()).toContain('✓')  // done
    expect(lastFrame()).toContain('✗')  // failed
  })

  it('renders elapsed time', () => {
    const { lastFrame } = render(
      <TaskList tasks={mockTasks} selectedIndex={0} focused={true} width={30} />
    )
    expect(lastFrame()).toContain('1m 30s')
  })

  it('renders empty state message when no tasks', () => {
    const { lastFrame } = render(
      <TaskList tasks={[]} selectedIndex={0} focused={true} width={30} />
    )
    expect(lastFrame()).toContain('No tasks yet')
  })
})
