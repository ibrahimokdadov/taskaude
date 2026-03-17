import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { TaskList } from './components/TaskList.jsx'
import { Output, VISIBLE_LINES } from './components/Output.jsx'

export function App({ store, watcher, baseDir }) {
  const [tasks, setTasks] = useState([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [focusPane, setFocusPane] = useState('left')
  const [scrollOffset, setScrollOffset] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const { exit } = useApp()
  const columns = process.stdout.columns ?? 80
  const rows = process.stdout.rows ?? 24

  const refresh = useCallback(() => {
    setTasks([...store.getAll()])
  }, [store])

  useEffect(() => {
    watcher.on('task:new', ({ id, outputPath }) => {
      store.upsert(id, outputPath)
      refresh()
    })
    watcher.on('task:update', ({ id, output }) => {
      store.update(id, output)
      refresh()
    })
    watcher.on('task:idle', ({ id }) => {
      store.markIdle(id)
      refresh()
    })
    watcher.on('error', err => {
      setStatusMsg(`Error: ${err.message}`)
    })

    // Start AFTER registering handlers so no events are missed
    watcher.start(baseDir).catch(err => setStatusMsg(`Error starting watcher: ${err.message}`))

    return () => watcher.close()
  }, [])

  useInput((input, key) => {
    if (input === 'q') { exit(); return }
    if (key.tab) {
      setFocusPane(p => p === 'left' ? 'right' : 'left')
      setScrollOffset(0)
      return
    }
    if (input === 'r') {
      store.reloadAll()
      refresh()
      return
    }
    if (focusPane === 'left') {
      if (key.upArrow) { setSelectedIndex(i => Math.max(0, i - 1)); setScrollOffset(0) }
      if (key.downArrow) { setSelectedIndex(i => Math.min(tasks.length - 1, i + 1)); setScrollOffset(0) }
    }
    if (focusPane === 'right') {
      const selected = tasks[selectedIndex]
      if (!selected) return
      if (input === 'c') {
        store.clearOutput(selected.id)
        setScrollOffset(0)
        refresh()
      }
      const lineCount = selected.output.split('\n').length
      const maxScroll = Math.max(0, lineCount - VISIBLE_LINES)
      if (key.upArrow) setScrollOffset(o => Math.max(0, o - 1))
      if (key.downArrow) setScrollOffset(o => Math.min(maxScroll, o + 1))
    }
  })

  const selected = tasks[selectedIndex] ?? null
  const leftWidth = Math.floor(columns * 0.35)

  const hint = focusPane === 'left'
    ? '↑↓ navigate  Tab output  q quit'
    : '↑↓ scroll  c clear  r refresh  Tab list  q quit'

  return (
    <Box flexDirection="column" height={rows}>
      <Box flexGrow={1}>
        <TaskList
          tasks={tasks}
          selectedIndex={selectedIndex}
          focused={focusPane === 'left'}
          width={leftWidth}
        />
        <Output
          task={selected}
          scrollOffset={scrollOffset}
          focused={focusPane === 'right'}
        />
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{statusMsg || hint}</Text>
      </Box>
    </Box>
  )
}
