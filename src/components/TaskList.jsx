import React from 'react'
import { Box, Text } from 'ink'
import { statusIcon } from '../utils.js'

export function TaskList({ tasks, selectedIndex, focused, width }) {
  if (!tasks.length) {
    return (
      <Box width={width} flexDirection="column" paddingX={1}>
        <Text dimColor>No tasks yet.</Text>
        <Text dimColor>Run a background command in Claude Code.</Text>
      </Box>
    )
  }

  return (
    <Box width={width} flexDirection="column">
      <Box paddingX={1}>
        <Text dimColor bold>TASKS ({tasks.length})</Text>
      </Box>
      {tasks.map((task, i) => {
        const isSelected = i === selectedIndex
        const color = task.status === 'running' ? 'blue'
          : task.status === 'done' ? 'green'
          : task.status === 'failed' ? 'red'
          : undefined

        return (
          <Box key={task.id} flexDirection="column" paddingLeft={isSelected ? 0 : 2}>
            <Box>
              {isSelected && <Text color={focused ? 'blue' : 'gray'}> › </Text>}
              {!isSelected && <Text>   </Text>}
              <Text color={color}>{statusIcon(task.status)} </Text>
              <Text color={isSelected ? 'blue' : undefined} bold={isSelected}>
                {task.id}
              </Text>
            </Box>
            <Box marginLeft={isSelected ? 4 : 3}>
              <Text dimColor>{task.status}  {task.elapsed}  </Text>
              <Text color="cyan" dimColor>{task.project}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
