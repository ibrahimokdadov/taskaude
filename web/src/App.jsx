import React, { useState, useEffect } from 'react'
import ProjectList from './components/ProjectList.jsx'
import TaskList from './components/TaskList.jsx'
import Output from './components/Output.jsx'
import CalendarPanel from './components/CalendarPanel.jsx'

export default function App() {
  const [tasks, setTasks] = useState(new Map())
  const [selectedProject, setSelectedProject] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  // Calendar state
  const [view, setView] = useState('live')
  const [calendarDays, setCalendarDays] = useState([])
  const [selectedDate, setSelectedDate] = useState(null)
  const [historyTasks, setHistoryTasks] = useState([])
  const [selectedHistoryId, setSelectedHistoryId] = useState(null)

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
  const selectedHistoryTask = historyTasks.find(t => t.id === selectedHistoryId) ?? null

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

  // Switch to calendar: load days once
  function handleViewSwitch(v) {
    setView(v)
    if (v === 'calendar' && calendarDays.length === 0) {
      fetch('/api/history/days')
        .then(r => r.json())
        .then(setCalendarDays)
        .catch(err => console.error('Failed to load history days:', err))
    }
  }

  // When selected date changes, load its tasks
  useEffect(() => {
    if (!selectedDate) return
    fetch(`/api/history/tasks?date=${selectedDate}`)
      .then(r => r.json())
      .then(tasks => {
        setHistoryTasks(tasks)
        setSelectedHistoryId(tasks[0]?.id ?? null)
      })
      .catch(err => console.error('Failed to load history tasks:', err))
  }, [selectedDate])

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 font-mono">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <span className="text-blue-400 font-bold text-sm tracking-wide">taskaude</span>
        <span className="text-gray-500 text-xs">
          {tasksArray.length} task{tasksArray.length !== 1 ? 's' : ''}
        </span>
        {/* View tabs */}
        <div className="flex gap-1 ml-3">
          {['live', 'calendar'].map(v => (
            <button
              key={v}
              onClick={() => handleViewSwitch(v)}
              className={`text-xs px-3 py-1 rounded cursor-pointer transition-colors capitalize
                ${view === v
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 hover:text-gray-300 border border-gray-700'
                }`}
            >
              {v}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-gray-600">
          {new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
        </span>
      </header>

      <div className="flex flex-row flex-1 overflow-hidden">
        {view === 'live' ? (
          <>
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
          </>
        ) : (
          <>
            <CalendarPanel
              days={calendarDays}
              selectedDate={selectedDate}
              onSelect={setSelectedDate}
            />
            <TaskList
              tasks={historyTasks}
              selectedId={selectedHistoryId}
              onSelect={setSelectedHistoryId}
            />
            <Output task={selectedHistoryTask} readOnly />
          </>
        )}
      </div>
    </div>
  )
}
