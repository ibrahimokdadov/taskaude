import React, { useRef, useEffect, useState } from 'react'
import { formatElapsed, statusIcon } from '../utils.js'

const STATUS_BADGE = {
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  done:    'bg-green-500/20 text-green-400 border-green-500/30',
  failed:  'bg-red-500/20 text-red-400 border-red-500/30',
  unknown: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

export default function Output({ task }) {
  const containerRef = useRef(null)
  // userScrolled: true when the user has scrolled up; suppresses auto-scroll
  const [userScrolled, setUserScrolled] = useState(false)
  // Tick every second so elapsed time in the header stays live
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  // Auto-scroll to bottom when output changes, unless user scrolled up
  useEffect(() => {
    if (!userScrolled && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [task?.output, userScrolled])

  // Reset scroll lock when switching to a different task
  useEffect(() => {
    setUserScrolled(false)
  }, [task?.id])

  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
    setUserScrolled(!atBottom)
  }

  if (!task) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        Select a task to view its output.
      </div>
    )
  }

  const badgeClass = STATUS_BADGE[task.status] ?? STATUS_BADGE.unknown
  const elapsed = formatElapsed(new Date(task.startTime).getTime())

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900/50 flex-shrink-0 flex-wrap gap-y-1">
        <span className="text-sm text-gray-200 font-medium truncate max-w-xs">{task.title ?? task.id}</span>
        <span className={`text-xs px-2 py-0.5 rounded border ${badgeClass}`}>
          {statusIcon(task.status)} {task.status}
        </span>
        <span className="text-xs text-gray-500">{elapsed}</span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => fetch(`/api/tasks/${task.id}/clear`, { method: 'POST' })}
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
          >
            Clear
          </button>
          <button
            onClick={() => fetch('/api/reload', { method: 'POST' })}
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
          >
            Reload All
          </button>
        </div>
      </div>

      {/* Output */}
      <pre
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-4 text-xs text-gray-300 whitespace-pre-wrap break-words leading-relaxed"
      >
        {task.output
          ? task.output
          : <span className="text-gray-600">No output yet.</span>
        }
      </pre>
    </div>
  )
}
