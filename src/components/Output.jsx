import React from 'react'
import { Box, Text } from 'ink'
import { normalizeOutput } from '../utils.js'

const VISIBLE_LINES = 30

export function Output({ task, scrollOffset, focused }) {
  if (!task) {
    return (
      <Box flexGrow={1} paddingX={1} alignItems="center" justifyContent="center">
        <Text dimColor>Select a task to view output</Text>
      </Box>
    )
  }

  const normalized = normalizeOutput(task.output)
  const allLines = normalized.split('\n')
  const visible = allLines.slice(scrollOffset, scrollOffset + VISIBLE_LINES)

  return (
    <Box flexGrow={1} flexDirection="column">
      <Box paddingX={1}>
        <Text bold color="blue">{task.id}</Text>
        <Text dimColor>  started {task.elapsed} ago  ·  {task.status}</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        {visible.map((line, i) => (
          <Text key={scrollOffset + i} wrap="truncate">{line}</Text>
        ))}
      </Box>
      {allLines.length > VISIBLE_LINES && (
        <Box paddingX={1}>
          <Text dimColor>
            line {scrollOffset + 1}–{Math.min(scrollOffset + VISIBLE_LINES, allLines.length)} of {allLines.length}
          </Text>
        </Box>
      )}
    </Box>
  )
}
