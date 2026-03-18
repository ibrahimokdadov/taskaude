import React from 'react'

export default function ProjectList({ projects, selectedProject, onSelect }) {
  if (!projects.length) {
    return (
      <div className="w-44 flex-shrink-0 border-r border-gray-800 flex flex-col items-center justify-center text-gray-600 text-sm p-4 gap-1">
        <span>No projects yet.</span>
        <span className="text-xs text-gray-700 text-center">Run a background command in Claude Code.</span>
      </div>
    )
  }

  return (
    <div className="w-44 flex-shrink-0 border-r border-gray-800 overflow-y-auto">
      <div className="px-3 py-2 text-xs text-gray-600 font-semibold uppercase tracking-wider">
        Projects
      </div>
      <ul>
        {projects.map(({ name, session, runningCount }) => {
          const isSelected = selectedProject?.name === name && selectedProject?.session === session
          return (
            <li
              key={`${name}/${session}`}
              onClick={() => onSelect({ name, session })}
              className={[
                'px-3 py-2 cursor-pointer border-b border-gray-800/50 select-none',
                isSelected ? 'bg-gray-800' : 'hover:bg-gray-900',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm truncate ${isSelected ? 'text-white font-medium' : 'text-gray-300'}`}>
                  {name}
                </span>
                {runningCount > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 flex-shrink-0">
                    {runningCount}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-600 font-mono mt-0.5 truncate">
                {session.slice(0, 8)}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
