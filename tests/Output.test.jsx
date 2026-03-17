import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Output } from '../src/components/Output.jsx'

const mockTask = {
  id: 'abc123',
  status: 'running',
  elapsed: '1m 30s',
  startTime: new Date(Date.now() - 90000),
  output: 'line 1\nline 2\nline 3\n',
}

describe('Output', () => {
  it('renders task ID in header', () => {
    const { lastFrame } = render(
      <Output task={mockTask} scrollOffset={0} focused={false} />
    )
    expect(lastFrame()).toContain('abc123')
  })

  it('renders output lines', () => {
    const { lastFrame } = render(
      <Output task={mockTask} scrollOffset={0} focused={false} />
    )
    expect(lastFrame()).toContain('line 1')
    expect(lastFrame()).toContain('line 2')
  })

  it('renders empty state when no task selected', () => {
    const { lastFrame } = render(
      <Output task={null} scrollOffset={0} focused={false} />
    )
    expect(lastFrame()).toContain('Select a task')
  })

  it('respects scrollOffset', () => {
    const manyLines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
    const task = { ...mockTask, output: manyLines }
    const { lastFrame: frame0 } = render(
      <Output task={task} scrollOffset={0} focused={false} />
    )
    const { lastFrame: frame10 } = render(
      <Output task={task} scrollOffset={10} focused={false} />
    )
    expect(frame0()).toContain('line 1')
    expect(frame10()).not.toMatch(/\bline 1\b/)
    expect(frame10()).toContain('line 11')
  })
})
