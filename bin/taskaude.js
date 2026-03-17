#!/usr/bin/env node
import { start } from '../src/server.js'
import open from 'open'

let port
try {
  port = await start()
} catch (err) {
  console.error(`Failed to start taskaude: ${err.message}`)
  process.exit(1)
}

console.log(`taskaude running at http://localhost:${port}`)
await open(`http://localhost:${port}`)
// Process stays alive because the HTTP server is listening
