import React, { useState, useEffect } from 'react'
import { formatElapsed, statusIcon } from '../utils.js'

const STATUS_CLASSES = {
  running: 'text-blue-400',
  done:    'text-green-400',
  failed:  'text-red-400',
  unknown: 'text-gray-500',
}

export default function TaskList({ tasks, selectedId, onSelect }) {
  // Tick every second to update elapsed time display
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  if (!tasks.length) {
    return (
      <div className="w-80 flex-shrink-0 border-r border-gray-800 flex flex-col items-center justify-center text-gray-600 text-sm p-6 gap-1">
        <span>No tasks yet.</span>
        <span className="text-xs text-gray-700">Run a background command in Claude Code.</span>
      </div>
    )
  }

  return (
    <div className="w-80 flex-shrink-0 border-r border-gray-800 overflow-y-auto">
      <ul>
        {tasks.map(task => {
          const isSelected = task.id === selectedId
          const colorClass = STATUS_CLASSES[task.status] ?? STATUS_CLASSES.unknown
          const elapsed = formatElapsed(new Date(task.startTime).getTime())

          return (
            <li
              key={task.id}
              onClick={() => onSelect(task.id)}
              className={[
                'px-3 py-2 cursor-pointer border-b border-gray-800/50 select-none',
                isSelected ? 'bg-gray-800' : 'hover:bg-gray-900',
              ].join(' ')}
            >
              {/* Row 1: status icon + task ID */}
              <div className="flex items-center gap-2">
                <span className={`text-sm ${colorClass}`}>{statusIcon(task.status)}</span>
                <span className={`text-sm truncate ${isSelected ? 'text-white font-medium' : 'text-gray-300'}`}>
                  {task.id}
                </span>
              </div>
              {/* Row 2: elapsed + project */}
              <div className="flex items-center gap-2 mt-0.5 pl-5">
                <span className="text-xs text-gray-500">{elapsed}</span>
                <span className="text-xs text-cyan-700">{task.project}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
