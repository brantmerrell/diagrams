// Writes tech/tags.json — a static stand-in for /api/tech/tags so the
// frontend's tag filter works on GitHub Pages, where there is no backend.
// Run before copying tech/ into dist/. Same shape as the API response.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildTagsIndex } from './lib/tags.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const index = buildTagsIndex(root)

const outFile = path.join(root, 'tech', 'tags.json')
fs.writeFileSync(outFile, JSON.stringify(index, null, 2) + '\n')
console.log(`wrote tech/tags.json (${index.vocabulary.length} tags, ${Object.keys(index.tags).length} tagged diagrams)`)
