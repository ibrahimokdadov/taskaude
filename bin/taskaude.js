#!/usr/bin/env node
import React from 'react'
import { render } from 'ink'
import { App } from '../src/app.jsx'
import { TaskStore } from '../src/store.js'
import { FileWatcher } from '../src/watcher.js'
import { resolveBaseDir } from '../src/utils.js'
import fs from 'fs'

const baseDir = resolveBaseDir()

if (!fs.existsSync(baseDir)) {
  console.error(`Claude Code task directory not found: ${baseDir}`)
  console.error('Make sure Claude Code has been run at least once.')
  process.exit(1)
}

const store = new TaskStore()
const watcher = new FileWatcher()

const { waitUntilExit } = render(
  <App store={store} watcher={watcher} baseDir={baseDir} />
)

await waitUntilExit()
