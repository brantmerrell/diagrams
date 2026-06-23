export type NodeStatus = 'implemented' | 'in-progress' | 'proposed' | 'deprecated'

export interface EndpointContract {
  request?: string
  response?: string
  notes?: string
}

export interface ArchNode {
  label: string
  description?: string      // shown as tooltip on hover
  type?: string
  subtype?: string
  method?: string           // HTTP verb for endpoint nodes
  contract?: EndpointContract
  repo?: string
  path?: string
  tags?: string[]
  status?: NodeStatus
  notes?: string
  children?: Record<string, ArchNode>
}

export interface ArchEdge {
  from: string
  to: string
  label?: string
  type?: string
  status?: NodeStatus
  notes?: string
}

export interface ArchView {
  label: string
  description?: string
  detail_max?: number
  tags_include?: string[]
  nodes_include?: string[]
  status_include?: NodeStatus[]
  renderer?: string
  file?: string
  mermaid_file?: string
}

export interface ArchData {
  nodes: Record<string, ArchNode>
  edges: Record<string, ArchEdge>
  views: Record<string, ArchView>
}
