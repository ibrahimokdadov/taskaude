import React, { useState, useEffect } from 'react'
import ProjectList from './components/ProjectList.jsx'
import TaskList from './components/TaskList.jsx'
import Output from './components/Output.jsx'

export default function App() {
  const [tasks, setTasks] = useState(new Map())
  const [selectedProject, setSelectedProject] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  // Derive sorted project list and filtered tasks from the task map
  const tasksArray = [...tasks.values()]

  const projects = [...new Map(
    tasksArray.map(t => [`${t.project}/${t.session}`, { name: t.project, session: t.session }])
  ).values()]
    .sort((a, b) => `${a.name}/${a.session}`.localeCompare(`${b.name}/${b.session}`))
    .map(({ name, session }) => ({
      name,
      session,
      runningCount: tasksArray.filter(t => t.project === name && t.session === session && t.status === 'running').length,
    }))

  const filteredTasks = tasksArray.filter(t => t.project === selectedProject?.name && t.session === selectedProject?.session)
  const selectedTask = tasks.get(selectedId) ?? null

  function autoSelectProject(taskArray, current) {
    if (current && taskArray.some(t => t.project === current.name && t.session === current.session)) {
      return current
    }
    const pairs = [...new Map(taskArray.map(t => [`${t.project}/${t.session}`, { name: t.project, session: t.session }])).values()]
      .sort((a, b) => `${a.name}/${a.session}`.localeCompare(`${b.name}/${b.session}`))
    return pairs[0] ?? null
  }

  function mergeSingle(task) {
    setTasks(prev => new Map(prev).set(task.id, task))
    setSelectedProject(prev => prev ?? { name: task.project, session: task.session })
    setSelectedId(prev => prev ?? task.id)
  }

  function replaceAll(taskArray) {
    setTasks(new Map(taskArray.map(t => [t.id, t])))
    setSelectedProject(prev => autoSelectProject(taskArray, prev))
    setSelectedId(prev => {
      if (prev && taskArray.find(t => t.id === prev)) return prev
      return taskArray[0]?.id ?? null
    })
  }

  useEffect(() => {
    fetch('/api/tasks')
      .then(r => r.json())
      .then(replaceAll)
      .catch(err => console.error('Failed to load tasks:', err))

    const es = new EventSource('/events')
    es.addEventListener('task:new',    e => mergeSingle(JSON.parse(e.data)))
    es.addEventListener('task:update', e => mergeSingle(JSON.parse(e.data)))
    es.addEventListener('task:idle',   e => mergeSingle(JSON.parse(e.data)))
    es.addEventListener('reload',      e => replaceAll(JSON.parse(e.data).tasks))
    es.onerror = () => console.error('SSE connection lost')
    return () => es.close()
  }, [])

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 font-mono">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <span className="text-blue-400 font-bold text-sm tracking-wide">taskaude</span>
        <span className="text-gray-500 text-xs">
          {tasksArray.length} task{tasksArray.length !== 1 ? 's' : ''}
        </span>
      </header>
      <div className="flex flex-row flex-1 overflow-hidden">
        <ProjectList
          projects={projects}
          selectedProject={selectedProject}
          onSelect={({ name, session }) => {
            setSelectedProject({ name, session })
            const first = tasksArray.find(t => t.project === name && t.session === session)
            setSelectedId(first?.id ?? null)
          }}
        />
        <TaskList
          tasks={filteredTasks}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <Output task={selectedTask} />
      </div>
    </div>
  )
}
