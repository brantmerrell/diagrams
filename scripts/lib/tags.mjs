// Quality-tag extraction shared by server.js (/api/tech/tags) and
// scripts/build-tags-manifest.mjs (static tags.json for GitHub Pages).
//
// The tag vocabulary is the set of top-level class names defined in
// tags.d2 (compiles, styled, coherent, …). A diagram carries a
// tag when its source applies that class somewhere, e.g. `_quality: {class: compiles}`.
import fs from 'fs'
import path from 'path'

const CLASS_FILE = 'tags.d2'

export function* walkD2Files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walkD2Files(full)
    else if (entry.name.endsWith('.d2')) yield full
  }
}

/** Top-level keys of the quality-classes d2 file, e.g. ["compiles", "styled", "coherent"]. */
export function readTagVocabulary(root) {
  const file = path.join(root, CLASS_FILE)
  if (!fs.existsSync(file)) return []
  const source = fs.readFileSync(file, 'utf-8')
  const vocabulary = []
  for (const line of source.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:/)
    if (m) vocabulary.push(m[1])
  }
  return vocabulary
}

/**
 * Tags used in one d2 source: every `class: name` or `class: [a; b]` value
 * that appears in the vocabulary.
 */
export function extractTagsFromSource(source, vocabulary) {
  const found = new Set()
  for (const m of source.matchAll(/\bclass\s*:\s*(\[[^\]]*\]|[^\s;{}]+)/g)) {
    const value = m[1]
    const names = value.startsWith('[')
      ? value.slice(1, -1).split(/[;,]/).map(s => s.trim())
      : [value]
    for (const name of names) {
      if (vocabulary.includes(name)) found.add(name)
    }
  }
  return [...found]
}

/**
 * Build the full index: { vocabulary, tags } where tags maps canonical
 * diagram paths (`/tech/foo/bar.d2`, or `/class_legend.d2` for a diagram
 * that lives at the repo root next to classes.d2) to their tag arrays.
 * Untagged diagrams are omitted.
 */
export function buildTagsIndex(root) {
  const vocabulary = readTagVocabulary(root)
  const tags = {}
  if (vocabulary.length > 0) {
    for (const d2File of diagramFiles(root)) {
      const source = fs.readFileSync(d2File, 'utf-8')
      const fileTags = extractTagsFromSource(source, vocabulary)
      if (fileTags.length === 0) continue
      const canonical = '/' + path.relative(root, d2File).replace(/\\/g, '/')
      tags[canonical] = fileTags
    }
  }
  return { vocabulary, tags }
}

/**
 * Every .d2 file that can be a diagram: all of tech/ recursively, plus any
 * .d2 at the repo root (class_legend.d2 sits beside the classes.d2 and tags.d2
 * it documents). The tag vocabulary file itself is excluded — it defines the
 * classes rather than applying them, so indexing it would list the vocabulary
 * as a diagram carrying every tag.
 */
function* diagramFiles(root) {
  const techDir = path.join(root, 'tech')
  if (fs.existsSync(techDir)) yield* walkD2Files(techDir)
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.d2')) continue
    if (entry.name === CLASS_FILE) continue
    yield path.join(root, entry.name)
  }
}
