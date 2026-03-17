import React, { useState, useEffect } from 'react'
import TaskList from './components/TaskList.jsx'
import Output from './components/Output.jsx'

export default function App() {
  const [tasks, setTasks] = useState(new Map())
  const [selectedId, setSelectedId] = useState(null)

  function mergeSingle(task) {
    setTasks(prev => new Map(prev).set(task.id, task))
    setSelectedId(prev => prev ?? task.id)
  }

  function replaceAll(taskArray) {
    setTasks(new Map(taskArray.map(t => [t.id, t])))
    setSelectedId(prev => {
      // Keep current selection if it still exists; otherwise pick first
      if (prev && taskArray.find(t => t.id === prev)) return prev
      return taskArray[0]?.id ?? null
    })
  }

  useEffect(() => {
    // Initial load
    fetch('/api/tasks')
      .then(r => r.json())
      .then(replaceAll)
      .catch(err => console.error('Failed to load tasks:', err))

    // SSE connection
    const es = new EventSource('/events')

    es.addEventListener('task:new',    e => mergeSingle(JSON.parse(e.data)))
    es.addEventListener('task:update', e => mergeSingle(JSON.parse(e.data)))
    es.addEventListener('task:idle',   e => mergeSingle(JSON.parse(e.data)))
    es.addEventListener('reload',      e => replaceAll(JSON.parse(e.data).tasks))

    es.onerror = () => console.error('SSE connection lost')

    return () => es.close()
  }, [])

  const tasksArray = [...tasks.values()]
  const selectedTask = tasks.get(selectedId) ?? null

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 font-mono">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <span className="text-blue-400 font-bold text-sm tracking-wide">taskaude</span>
        <span className="text-gray-500 text-xs">
          {tasksArray.length} task{tasksArray.length !== 1 ? 's' : ''}
        </span>
      </header>
      <div className="flex flex-row flex-1 overflow-hidden">
        <TaskList
          tasks={tasksArray}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <Output task={selectedTask} />
      </div>
    </div>
  )
}
