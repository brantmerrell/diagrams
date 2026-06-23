import type { ArchData, ArchNode, ArchView, NodeStatus } from './architectureTypes'

// ── Node resolution ───────────────────────────────────────────────────────────

/**
 * Collect every node ID (including children at depth <= detail_max) that a
 * view should display, based on its nodes_include, tags_include, and
 * status_include filters.
 */
function resolveVisibleNodeIds(
  nodes: Record<string, ArchNode>,
  view: ArchView,
): Set<string> {
  const visible = new Set<string>()
  const statusFilter = new Set<NodeStatus>(view.status_include ?? ['implemented'])
  const detail = view.detail_max ?? 2

  const addNode = (id: string, node: ArchNode, depth: number) => {
    if (node.status && !statusFilter.has(node.status)) return
    visible.add(id)
    if (depth < detail && node.children) {
      for (const [cid, child] of Object.entries(node.children)) {
        addNode(`${id}.${cid}`, child, depth + 1)
      }
    }
  }

  // explicit node list takes priority
  if (view.nodes_include && view.nodes_include.length > 0) {
    for (const spec of view.nodes_include) {
      // spec may be "node-id" or "node-id.child-id"
      const [rootId, ...rest] = spec.split('.')
      const root = nodes[rootId]
      if (!root) continue
      if (rest.length === 0) {
        addNode(rootId, root, 1)
      } else {
        // drill to the child
        let cur: ArchNode | undefined = root
        let curId = rootId
        for (const part of rest) {
          cur = cur?.children?.[part]
          curId = `${curId}.${part}`
        }
        if (cur) addNode(curId, cur, detail)
      }
    }
    return visible
  }

  // tag-based selection — empty/absent tags_include means no nodes
  const tagFilter = view.tags_include && view.tags_include.length > 0
    ? new Set(view.tags_include)
    : null

  if (!tagFilter) return visible  // nothing selected

  for (const [id, node] of Object.entries(nodes)) {
    if (!node.tags?.some(t => tagFilter.has(t))) continue
    addNode(id, node, 1)
  }

  return visible
}

// ── Label helpers ─────────────────────────────────────────────────────────────

function mmdId(id: string): string {
  // Mermaid node IDs can't contain dots or hyphens — replace with underscores
  return id.replace(/[.\-]/g, '_')
}

function mmdLabel(id: string, node: ArchNode): string {
  const label = node.label ?? id
  // Escape double-quotes inside the label
  return label.replace(/"/g, "'")
}

function nodeShape(node: ArchNode, open: string, close: string): string {
  return `${open}"${mmdLabel('', node)}"${close}`
}

function shapeFor(node: ArchNode): [string, string] {
  switch (node.subtype) {
    case 'relational':
    case 'object-storage': return ['[(', ')]']
    case 'queue':          return ['([', '])']
    case 'stream':         return ['([', '])']
    case 'pubsub':         return ['([', '])']
    case 'frontend':       return ['[/', '/]']
    case 'worker':         return ['>', ']']
    case 'temporal-workflow': return ['{{', '}}']
    case 'temporal-activity': return ['[/', '/]']
    case 'table':          return ['[(', ')]']
    default:               return ['[', ']']
  }
}

function statusStyle(status: NodeStatus | undefined): string {
  switch (status) {
    case 'proposed':    return ':::proposed'
    case 'in-progress': return ':::inprogress'
    case 'deprecated':  return ':::deprecated'
    default:            return ''
  }
}

// ── Edge type → Mermaid arrow ─────────────────────────────────────────────────

function arrowFor(type: string | undefined): string {
  switch (type) {
    case 'websocket-push':
    case 'redis-pubsub':
    case 'redis-stream-write':
    case 'redis-enqueue':       return '-->'
    case 'temporal-signal':     return '-.->'
    case 'temporal-start':      return '-->'
    case 'subprocess':          return '==>'
    case 'gitops-write':
    case 'gitops-sync':         return '-.->'
    case 'azure-blob-download':
    case 'azure-blob-upload':   return '-->'
    case 'in-process':          return '---'
    default:                    return '-->'
  }
}

// ── Subgraph grouping ─────────────────────────────────────────────────────────

const SUBGRAPH_GROUPS: Array<{ id: string; label: string; prefixes: string[] }> = [
  { id: 'sg_frontend',   label: 'Frontend',                   prefixes: ['management-ui', 'preview-web', 'client-experience-player'] },
  { id: 'sg_platformapi',label: 'Platform API',               prefixes: ['platform-api'] },
  { id: 'sg_publishing', label: 'Publishing Pipeline',        prefixes: ['asset-processor', 'blender-automation', 'blender-toolkit', 'materialx-generator'] },
  { id: 'sg_authoring',  label: 'Authoring (VES)',            prefixes: ['ves-agent', 'ves-workflow-commandlet', 'viz-platform-api-plugin', 'ue-project', 'authoring-workflow'] },
  { id: 'sg_vega',       label: 'Vega Infra',                 prefixes: ['temporal-bridge', 'temporal-worker', 'temporal-gateway', 'capacity-adapter', 'file-ingestion-workflow'] },
  { id: 'sg_azure',      label: 'Azure',                      prefixes: ['azure-blob', 'azure-aks', 'azure-vmss', 'azure-acr', 'azure-keyvault'] },
  { id: 'sg_shared',     label: 'Shared Infra',               prefixes: ['redis', 'postgres', 'temporal-cloud', 'argocd'] },
  { id: 'sg_devops',     label: 'DevOps',                     prefixes: ['ops-repo'] },
]

function assignSubgraph(nodeId: string): string | null {
  // Always match on the root ID only — children belong to the same group as their parent
  const root = nodeId.split('.')[0]
  for (const g of SUBGRAPH_GROUPS) {
    if (g.prefixes.includes(root)) return g.id
  }
  return null
}


// ── Main generator ────────────────────────────────────────────────────────────

/** Convert a mermaid-safe ID back to the dot-path node ID */
export function mmdIdToNodeId(mmdSafeId: string): string {
  // mmdId replaces . and - with _; we stored the original in the map
  // so we rebuild: underscores that were dots come from multi-segment ids.
  // This is lossy — we rely on the caller passing the full flat node map.
  return mmdSafeId // callers use flatNodeMap lookup instead
}

/** Flatten all nodes (including children) into a map of dotPath → ArchNode */
export function flattenNodes(nodes: Record<string, ArchNode>): Map<string, ArchNode> {
  const map = new Map<string, ArchNode>()
  const visit = (id: string, node: ArchNode) => {
    map.set(id, node)
    if (node.children) {
      for (const [cid, child] of Object.entries(node.children)) visit(`${id}.${cid}`, child)
    }
  }
  for (const [id, node] of Object.entries(nodes)) visit(id, node)
  return map
}

/** Build a reverse map: mermaid-safe-id → dot-path node id */
export function buildMmdToNodeIdMap(flatNodes: Map<string, ArchNode>): Map<string, string> {
  const map = new Map<string, string>()
  for (const id of flatNodes.keys()) map.set(mmdId(id), id)
  return map
}

export function generateMermaid(data: ArchData, viewId: string): string {
  const view = data.views[viewId]
  if (!view) return `flowchart LR\n  missing["View '${viewId}' not found"]`

  const visibleIds = resolveVisibleNodeIds(data.nodes, view)

  // Flatten the node registry including children
  const flatNodes = new Map<string, ArchNode>()
  const flattenNode = (id: string, node: ArchNode) => {
    flatNodes.set(id, node)
    if (node.children) {
      for (const [cid, child] of Object.entries(node.children)) {
        flattenNode(`${id}.${cid}`, child)
      }
    }
  }
  for (const [id, node] of Object.entries(data.nodes)) flattenNode(id, node)

  // Only keep visible
  const renderNodes = [...visibleIds]
    .filter(id => flatNodes.has(id))
    .map(id => ({ id, node: flatNodes.get(id)! }))

  if (renderNodes.length === 0) {
    return `flowchart LR\n  empty["No nodes match this view's filters"]`
  }

  // Assign to subgraphs
  const groups = new Map<string, typeof renderNodes>()
  const ungrouped: typeof renderNodes = []
  for (const item of renderNodes) {
    const sg = assignSubgraph(item.id)
    if (sg) {
      if (!groups.has(sg)) groups.set(sg, [])
      groups.get(sg)!.push(item)
    } else {
      ungrouped.push(item)
    }
  }

  const lines: string[] = [
    `---`,
    `config:`,
    `  layout: elk`,
    `  theme: dark`,
    `---`,
    `flowchart LR`,
    ``,
    `  %% Styles`,
    `  classDef proposed    fill:#2a2a1a,stroke:#aaaa00,stroke-dasharray:5`,
    `  classDef inprogress  fill:#1a2a2a,stroke:#00aaaa,stroke-dasharray:3`,
    `  classDef deprecated  fill:#2a1a1a,stroke:#aa4444,stroke-dasharray:5`,
    ``,
  ]

  // Emit subgraphs
  for (const [sgId, items] of groups) {
    const meta = SUBGRAPH_GROUPS.find(g => g.id === sgId)!
    lines.push(`  subgraph ${sgId}["${meta.label}"]`)
    for (const { id, node } of items) {
      const [o, c] = shapeFor(node)
      lines.push(`    ${mmdId(id)}${nodeShape(node, o, c)}${statusStyle(node.status)}`)
    }
    lines.push(`  end`)
    lines.push(``)
  }

  // Ungrouped nodes
  for (const { id, node } of ungrouped) {
    const [o, c] = shapeFor(node)
    lines.push(`  ${mmdId(id)}${nodeShape(node, o, c)}${statusStyle(node.status)}`)
  }

  if (ungrouped.length > 0) lines.push(``)

  // Tooltips — emit for every node that has a description
  // Mermaid: click nodeId callback "tooltip text"
  // We use a no-op callback name; the SVG title attribute is what shows on hover
  const tooltipLines: string[] = []
  for (const { id, node } of renderNodes) {
    const tip = node.description ?? node.notes
    if (!tip) continue
    const escaped = tip.replace(/"/g, "'")
    tooltipLines.push(`  click ${mmdId(id)} archNodeClick "${escaped}"`)
  }
  if (tooltipLines.length) {
    lines.push(`  %% Tooltips`)
    lines.push(...tooltipLines)
    lines.push(``)
  }

  // Collapse a dot-path ID to the nearest ancestor that is actually rendered.
  // e.g. "platform-api.publishing-queue" → "platform-api" when the child
  // isn't in visibleIds. Returns null if no ancestor is visible.
  const resolveToVisible = (id: string): string | null => {
    const parts = id.split('.')
    for (let i = parts.length; i >= 1; i--) {
      const candidate = parts.slice(0, i).join('.')
      if (visibleIds.has(candidate)) return candidate
    }
    return null
  }

  // Edges — only between visible nodes (or their visible ancestors)
  const edgeLines: string[] = []
  for (const [, edge] of Object.entries(data.edges)) {
    if (!edge?.from || !edge?.to) continue

    const from = resolveToVisible(edge.from)
    const to   = resolveToVisible(edge.to)
    if (!from || !to || from === to) continue

    // Only show label when both endpoints are the exact nodes named in the edge
    // (i.e. nothing was collapsed). Collapsed edges aggregate multiple calls.
    const wasCollapsed = from !== edge.from || to !== edge.to
    const arrow = arrowFor(edge.type)
    const label = (!wasCollapsed && edge.label)
      ? `|"${edge.label.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 60)}"|`
      : ''
    edgeLines.push(`  ${mmdId(from)} ${arrow}${label} ${mmdId(to)}`)
  }

  // Deduplicate edges (parent-collapse can create duplicates)
  const seen = new Set<string>()
  for (const line of edgeLines) {
    if (!seen.has(line)) { seen.add(line); lines.push(line) }
  }

  return lines.join('\n')
}
