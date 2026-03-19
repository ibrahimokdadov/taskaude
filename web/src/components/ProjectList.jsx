import React, { useState, useEffect } from 'react'

function formatSessionDate(date) {
  const today = new Date()
  const d = new Date(date)
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ProjectList({ projects, selectedProject, onSelect }) {
  const [expanded, setExpanded] = useState(new Set())

  // Auto-expand the project containing the selected session
  useEffect(() => {
    if (selectedProject?.name) {
      setExpanded(prev => new Set([...prev, selectedProject.name]))
    }
  }, [selectedProject?.name])

  function toggleExpand(name, sessions) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
        // Auto-select the first session when expanding if nothing selected for this project
        if (!selectedProject || selectedProject.name !== name) {
          onSelect({ name, session: sessions[0].session })
        }
      }
      return next
    })
  }

  if (!projects.length) {
    return (
      <div className="w-48 flex-shrink-0 border-r border-gray-800 flex flex-col items-center justify-center text-gray-600 text-sm p-4 gap-1">
        <span>No projects yet.</span>
        <span className="text-xs text-gray-700 text-center">Run a background command in Claude Code.</span>
      </div>
    )
  }

  return (
    <div className="w-48 flex-shrink-0 border-r border-gray-800 overflow-y-auto">
      <div className="px-3 py-2 text-xs text-gray-600 font-semibold uppercase tracking-wider border-b border-gray-800">
        Projects
      </div>
      <ul>
        {projects.map(({ name, sessions, hasRunning }) => {
          const isOpen = expanded.has(name)
          const isProjectSelected = selectedProject?.name === name

          return (
            <li key={name}>
              {/* Project row */}
              <div
                onClick={() => toggleExpand(name, sessions)}
                className={[
                  'flex items-center gap-2 px-3 py-2 cursor-pointer select-none border-b border-gray-800/50',
                  isProjectSelected ? 'bg-gray-800/60' : 'hover:bg-gray-900',
                ].join(' ')}
              >
                {/* Chevron */}
                <span className={`text-gray-600 text-[10px] transition-transform duration-150 flex-shrink-0 ${isOpen ? 'rotate-90' : ''}`}>
                  ▶
                </span>
                <span className={`text-sm truncate flex-1 ${isProjectSelected ? 'text-white font-medium' : 'text-gray-300'}`}>
                  {name}
                </span>
                {hasRunning && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0 animate-pulse" />
                )}
              </div>

              {/* Sessions */}
              {isOpen && (
                <ul className="border-b border-gray-800/50">
                  {sessions.map(({ session, date, taskCount, runningCount }) => {
                    const isSelected = selectedProject?.name === name && selectedProject?.session === session
                    return (
                      <li
                        key={session}
                        onClick={() => onSelect({ name, session })}
                        className={[
                          'flex items-center gap-2 pl-7 pr-3 py-1.5 cursor-pointer select-none',
                          isSelected ? 'bg-blue-600/20 border-l-2 border-blue-500' : 'hover:bg-gray-800/50 border-l-2 border-transparent',
                        ].join(' ')}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs ${isSelected ? 'text-blue-300 font-medium' : 'text-gray-400'}`}>
                              {formatSessionDate(date)}
                            </span>
                            {runningCount > 0 && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 leading-none">
                                {runningCount} running
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-700 font-mono break-all mt-0.5">
                            {session}
                          </div>
                        </div>
                        <span className="text-[10px] text-gray-600 flex-shrink-0">
                          {taskCount}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
