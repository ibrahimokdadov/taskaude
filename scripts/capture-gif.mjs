import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HTML = path.join(__dirname, 'demo.html')
const OUT_DIR = path.join(__dirname, 'frames')
const GIF_OUT = path.join(__dirname, '..', 'taskaude-demo.gif')

// GIF encoder — pure JS, no native deps
// Using gifenc from npm
import gifencPkg from 'gifenc'
const { GIFEncoder, quantize, applyPalette } = gifencPkg

fs.mkdirSync(OUT_DIR, { recursive: true })

const W = 900, H = 580

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function captureFrame(page) {
  const buf = await page.screenshot({ type: 'png' })
  return buf
}

// Sequence of actions to demonstrate
async function runDemo(page) {
  const frames = [] // { buf, delay }

  async function snap(delayMs = 80) {
    const buf = await captureFrame(page)
    frames.push({ buf, delay: delayMs })
  }

  // Initial state — api-gateway selected, task-001 output visible
  await sleep(300)
  await snap(120)
  await snap(120)
  await snap(80)

  // Hold on initial state
  for (let i = 0; i < 8; i++) await snap(100)

  // Click data-pipeline project
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.project-row')
    rows[1].click()
  })
  await sleep(60)
  for (let i = 0; i < 6; i++) await snap(80)

  // Click the data-pipeline session
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.session-row')
    rows[2].click()
  })
  await sleep(60)
  for (let i = 0; i < 8; i++) await snap(80)

  // Click task-007
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.task-row')
    if (rows[1]) rows[1].click()
  })
  await sleep(60)
  for (let i = 0; i < 6; i++) await snap(80)

  // Click task-009
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.task-row')
    if (rows[3]) rows[3].click()
  })
  await sleep(60)
  for (let i = 0; i < 6; i++) await snap(80)

  // Back to api-gateway
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.project-row')
    rows[0].click()
  })
  await sleep(60)
  for (let i = 0; i < 5; i++) await snap(80)

  // Click second session of api-gateway
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.session-row')
    rows[1].click()
  })
  await sleep(60)
  for (let i = 0; i < 8; i++) await snap(90)

  // Back to first session of api-gateway, running task
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.session-row')
    rows[0].click()
  })
  await sleep(60)
  for (let i = 0; i < 5; i++) await snap(80)

  // Click taskaude project
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.project-row')
    rows[2].click()
  })
  await sleep(60)
  for (let i = 0; i < 5; i++) await snap(80)

  // Select taskaude session
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.session-row')
    const last = rows[rows.length - 1]
    if (last) last.click()
  })
  await sleep(60)
  for (let i = 0; i < 10; i++) await snap(90)

  // Hold final state
  for (let i = 0; i < 6; i++) await snap(120)

  return frames
}

async function main() {
  console.log('Launching browser...')
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  await page.goto(`file:///${HTML.replace(/\\/g, '/')}`)
  await sleep(500)

  console.log('Capturing frames...')
  const frames = await runDemo(page)
  await browser.close()

  console.log(`Captured ${frames.length} frames. Encoding GIF...`)

  const gif = GIFEncoder()

  for (let i = 0; i < frames.length; i++) {
    process.stdout.write(`\r  encoding frame ${i + 1}/${frames.length}`)

    // Decode PNG to raw pixels using page screenshot (already have buffer)
    // We need to decode PNG — use pure JS PNG decoder
    const { PNG } = await import('pngjs')
    const png = PNG.sync.read(frames[i].buf)
    const { width, height, data } = png

    // data is RGBA Buffer
    const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)

    const palette = quantize(rgba, 256)
    const index = applyPalette(rgba, palette)

    gif.writeFrame(index, width, height, {
      palette,
      delay: frames[i].delay,
    })
  }

  gif.finish()
  const output = gif.bytes()
  fs.writeFileSync(GIF_OUT, output)

  const sizeMB = (output.byteLength / 1024 / 1024).toFixed(2)
  console.log(`\nDone! ${GIF_OUT}`)
  console.log(`Size: ${sizeMB} MB (${output.byteLength.toLocaleString()} bytes)`)

  if (output.byteLength > 10 * 1024 * 1024) {
    console.warn('⚠ Over 10MB — consider reducing frame count or quality')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
