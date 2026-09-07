// Quality-tag extraction shared by server.js (/api/tech/tags) and
// scripts/build-tags-manifest.mjs (static tags.json for GitHub Pages).
//
// The tag vocabulary is the set of top-level class names defined in
// tags.d2 (compiles, styled, coherent, …). A diagram carries a
// tag when its source applies that class somewhere, e.g. `_quality: {class: compiles}`.
import fs from 'fs'
import path from 'path'

const CLASS_FILE = 'tags.d2'

// Directories that never hold diagrams — skipped so a repo-wide walk doesn't
// descend into node_modules, doesn't pick up icons/scripts/public assets, and
// doesn't re-scan build output. Mirrors server.js's SVG_DENY list.
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'src', '.git', '.github', 'public', 'icons', 'scripts'])

export function* walkD2Files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue
      yield* walkD2Files(path.join(dir, entry.name))
    } else if (entry.name.endsWith('.d2')) {
      yield path.join(dir, entry.name)
    }
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
 * Every .d2 file that can be a diagram: anywhere in the repo (tech/ is just
 * where most of them happen to live — a new top-level directory needs no
 * code change to be picked up), excluding EXCLUDE_DIRS. The tag vocabulary
 * file itself is excluded — it defines the classes rather than applying
 * them, so indexing it would list the vocabulary as a diagram carrying
 * every tag.
 */
function* diagramFiles(root) {
  for (const file of walkD2Files(root)) {
    if (path.basename(file) === CLASS_FILE) continue
    yield file
  }
}
