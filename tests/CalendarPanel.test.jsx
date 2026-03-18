import { describe, it, expect } from 'vitest'
import CalendarPanel from '../web/src/components/CalendarPanel.jsx'

describe('CalendarPanel', () => {
  it('exports a default component', () => {
    expect(typeof CalendarPanel).toBe('function')
  })

  it('component name is CalendarPanel', () => {
    expect(CalendarPanel.name).toBe('CalendarPanel')
  })
})
