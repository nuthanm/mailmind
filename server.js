import http from 'http'
import { parse as parseUrl } from 'url'
import { StringDecoder } from 'string_decoder'
import fs from 'fs'
import path from 'path'
import * as dotenv from 'dotenv'

dotenv.config()

const PORT = Number(process.env.PORT || 3001)
const API_DIR = path.join(process.cwd(), 'api')

function setResponseHelpers(res) {
  res.status = function status(code) {
    res.statusCode = code
    return res
  }

  res.json = function json(payload) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
    }
    res.end(JSON.stringify(payload))
  }

  res.send = function send(payload) {
    if (typeof payload === 'object' && payload !== null) {
      return res.json(payload)
    }
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    }
    res.end(String(payload ?? ''))
  }
}

async function parseBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return null
  }

  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8')
    let buffer = ''

    req.on('data', chunk => {
      buffer += decoder.write(chunk)
      if (buffer.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'))
      }
    })

    req.on('end', () => {
      buffer += decoder.end()
      const contentType = req.headers['content-type'] || ''
      if (!buffer) return resolve(null)
      if (contentType.includes('application/json')) {
        try {
          resolve(JSON.parse(buffer))
        } catch {
          reject(new Error('Invalid JSON body'))
        }
        return
      }
      resolve(buffer)
    })

    req.on('error', reject)
  })
}

async function loadHandler(fileName) {
  const absPath = path.join(API_DIR, `${fileName}.js`)
  if (!fs.existsSync(absPath)) return null

  const mtimeMs = fs.statSync(absPath).mtimeMs
  const moduleUrl = new URL(`file://${absPath.replace(/\\/g, '/')}?v=${mtimeMs}`)
  const mod = await import(moduleUrl.href)
  const handler = mod.default
  if (typeof handler !== 'function') return null

  return handler
}

function getApiFile(pathname) {
  if (!pathname.startsWith('/api/')) return null
  const suffix = pathname.slice('/api/'.length)
  if (!suffix) return null
  const [firstSegment] = suffix.split('/')
  return firstSegment || null
}

const server = http.createServer(async (req, res) => {
  setResponseHelpers(res)

  try {
    const parsed = parseUrl(req.url || '/', true)
    req.query = parsed.query || {}
    req.path = parsed.pathname || '/'

    const apiFile = getApiFile(req.path)
    if (!apiFile) {
      return res.status(404).json({ ok: false, error: 'Not found' })
    }

    const handler = await loadHandler(apiFile)
    if (!handler) {
      return res.status(404).json({ ok: false, error: `No handler for /api/${apiFile}` })
    }

    req.body = await parseBody(req)

    await handler(req, res)

    if (!res.writableEnded) {
      res.end()
    }
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: error.message || 'Internal server error' })
      return
    }
    res.end()
  }
})

server.listen(PORT, () => {
  console.log(`Local API server listening on http://localhost:${PORT}`)
})
