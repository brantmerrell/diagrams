# Diagram Viewer

Interactive viewer for D2 architecture diagrams with integrated YAML structure navigation.

## Getting Started

Install d2: [d2lang.com/tour/install/](https://d2lang.com/tour/install/)  

install packages:
```bash
bun install
```

run app
```bash
npm run start  # Runs both backend and frontend (recommended)
```

Using the UX:

* The YAML viewer on the left selects diagrams
* YAML viewer can be toggled out of sight

Editing:

* Changes to .d2 files will be rendered in realtime
* New files must be referenced from the pointers.yaml file

MCP Config for copilot:

~/.copilot/mcp-config.json
```json
    "jbm-architecture": {
      "type": "local",
      "command": "node",
      "args": [
        "/Users/dzt44r/github/jbm/diagrams/mcp-server.js"
      ],
      "tools": [
        "*"
      ],
      "source": "user",
      "sourcePath": "/Users/dzt44r/.copilot/mcp-config.json"
    },
```

MCP Config for Claude Code:

TODO

## Common D2 Mistakes

### Layers

D2 `layers: {}` are the primary tool for keeping multiple diagram views in one file without them colliding on the canvas. The **base view** (what you see on load) should contain only `context: |yaml...|`. All diagram content belongs inside named layers.

- *Name layers by content type, not by number.* Use descriptive names (`sequence`, `investigation`, `ownership_shift`, `pipeline_overview`) so the layer switcher is self-documenting.

- *`shape: sequence_diagram` belongs on the layer container, not at top level.* When a layer contains a sequence diagram, put `shape: sequence_diagram` as the first property of the layer block. Actors and messages are children of that same block:
  ```d2
  layers: {
    sequence: {
      shape: sequence_diagram
      actor_a: { class: client }
      actor_b: { class: api }
      actor_a -> actor_b: "request"
    }
  }
  ```

- *`direction:` and other layout properties also belong inside the layer.* A top-level `direction: right` applies to the base view (where only `context:` is visible) and has no effect. Move it inside the layer that needs it.

- *Use alternating arrow direction to zig-zag a long linear flow.* When a straight `A → B → C → D → E` chain is too wide for comfortable reading, reversing alternate edges (`A → B`, `C ← B`, `C → D`, `E ← D`) causes ELK to fold the chain into rows, trading horizontal spread for vertical balance. Use this selectively — only when a flow is genuinely too linear to read at normal zoom. Don't apply it to short chains or to flows where the left-to-right reading order carries meaning.

  **To decide if zig-zag is needed**: render the diagram to SVG and inspect it. If nodes are strung out horizontally across more than ~2/3 of the viewport at a comfortable zoom level, zig-zag will help. 

  When applying zig-zag to a diagram that uses a top-level `direction: right`:
  1. Remove `direction: right` from the top level (it prevents ELK from folding)
  2. Add `direction: right` *inside* each container node that needs a left-to-right internal layout
  3. Alternate the cross-container arrows

  ```d2
  # Too wide — five nodes in a single horizontal band
  User -> Page: { class: do_not_change }
  Page -> Tab: { class: do_not_change }
  Tab -> Card: { class: do_not_change }
  Card -> Button: { class: do_not_change }
  Button -> Result: { class: to_add }

  # Zig-zag — same nodes, alternating arrows, ELK folds into two rows
  User -> Page: { class: do_not_change }
  Tab <- Page: { class: do_not_change }
  Tab -> Card: { class: do_not_change }
  Button <- Card: { class: do_not_change }
  Button -> Result: { class: to_add }
  ```

### Node and style syntax

- *In sequence diagrams, use `.note` child nodes instead of self-referencing arrows.* A `node -> node` arrow in a sequence diagram creates a loopback arc that looks like a round-trip call. For middleware guards, loop annotations, and other side-effects that aren't actual messages between actors, use a `.note` child node instead:
  ```d2
  # Wrong — renders as a loopback arc suggesting a self-call
  platform_api -> platform_api: "beforeHandle: experienceUserRoleValidation\n[PROJECT_CREATE, ADMIN]" {class: control}

  # Correct — renders as an annotation attached to the actor
  platform_api.note1: |md
    * beforeHandle: `experienceUserRoleValidation` [PROJECT_CREATE, ADMIN]
  |
  ```
  Multiple notes on the same actor are numbered: `.note1`, `.note2`, etc.

- *Content that implies real nodes must be drawn as nodes and edges — not dumped into a markdown block.* This is the most common failure mode of notes. Before writing any `|md` block, ask: does this text describe services, files, endpoints, rules, states, or relationships that already exist somewhere? If so, they are real things and belong in the diagram as nodes with edges — the whole point of a diagram. A markdown block is only for genuine annotation (a caveat, a "you are here" reminder, a reviewer aside) that has no structure of its own. Prose that narrates a relationship is a smell:
  ```d2
  # Wrong — the note narrates real nodes and an edge as text
  rule11: {
    label: "qa-tests.mdc RULE 11"
    note: |md
      * The plan lists **4** under *destructive — OUT OF SCOPE*.
      * It wires `guard -> pipeline.p1: STOP destructive cases`.
      * This PR implements the clone flow the plan forbids.
    |
  }

  # Correct — the guard, the out-of-scope bucket, and the STOP edge are real nodes/edges
  plan: {
    guard: "qa-tests.mdc RULE 11" {class: removed}
    destructive: "Create / Delete / Clone (incl. 4) — OUT OF SCOPE" {class: removed}
    p1: "qa-tests pipeline · p1" {class: existing}
    guard -> p1: "STOP destructive cases" {class: removed}
    guard -> destructive: "excluded by rule 11" {class: removed}
  }
  this_pr.clone_flow -> plan.destructive: "4 is here — automation forbidden" {class: removed}
  ```
  A quick test: *"• image-service runs in CGI VNet (snet-workers) • Authenticates against CGI Azure AD"* is not a note — it implies `image_svc`, `cgi_azure_ad`, and an auth edge between them. Draw them.

- *`label:` does not render markdown — use a named child node instead.* Assigning an `|md ...|` block to the `label` property strips all formatting and collapses everything to a single unstyled line. To get rendered markdown inside a container node, give it a named child (e.g. `note`) and assign the `|md` block there:
  ```d2
  # Wrong — label strips markdown; renders as one collapsed line
  my_container: "Required env (CGI-specific)" {
    label: |md
      ```text
      CONNECTOR=https://...
      ```
    |
  }

  # Correct — child node carries the markdown block
  my_container: "Required env (CGI-specific)" {
    note: |md
      ```text
      CONNECTOR=https://...
      ```
    |
  }
  ```


- *Unless otherwise specified, nodes must correspond to real things in the codebase or infrastructure — not abstract concepts or evaluation categories.* A node represents a file, service, function, class, API endpoint, database, queue, or other concrete entity. Abstract concepts like "Boundary Respect", "Resilience Improvements", or "Test Quality" are not real things and should not be nodes. 
  ```d2
  # Wrong — fake nodes for abstract concepts
  analysis: {
    boundary_respect: {
      label: "✅ Boundary Respect"
      note: |md
        - Changes within asset-processor/utils
        - No cross-service dependencies
      |
    }
    resilience: {
      label: "✅ Resilience"
      note: |md
        - Handles transient failures
      |
    }
    asset_processor -> boundary_respect: "impact"
  }

  # Correct — show real components and their relationships
  implementation: {
    asset_processor: {
      label: "asset-processor/\nsrc/utils/"
      class: modified
    }
    platform_api: {
      label: "platform-api\ngetSasTokenGeneric()"
      class: existing
    }
    azure_storage: {
      label: "Azure Storage"
      class: existing
    }
    asset_processor -> platform_api: "calls (with retry)" {class: new}
    platform_api -> azure_storage: "fetches SAS token" {class: existing}
  }
  ```
  Diagrams show *what exists and how it connects*. Analysis, evaluation, and recommendations belong in text (PR comments, design docs, or the commit message) — not as diagram nodes.

- *Classes belong on nodes (and edges), not on labels.* A `label` is a string property — it cannot have a `class` attached to it. Put the `class` on the node itself:
  ```d2
  # Wrong
  my_node: {
    label: "My Label" {
      class: highlight
    }
  }

  # Correct
  my_node: {
    class: highlight
    label: "My Label"
  }
  ```

- *Text goes in nodes; edge labels should be minimal or omitted.* When two edge labels sit on adjacent parallel arrows they overlap and become unreadable. Move context into the source or destination node label, and let the edge's `class` convey the relationship type (`do_not_change`, `to_add`, `to_modify`). Reserve edge labels only for information that cannot live on either endpoint — such as a cardinality annotation or a short verb that disambiguates multiple edges between the same pair of nodes:
  ```d2
  # Overlapping — two parallel edges with long labels
  udm_attributes -> current_opaque_set: "today: 3 channels used\n(color, roughness, metallic)"
  udm_attributes -> material_conversion_map: "R&D: map additional\nUDM attributes" {class: to_modify}

  # Correct — context folded into node labels; edges carry only class
  udm_attributes: {
    label: "UDM material attributes\nR&D: map additional attributes"
    class: do_not_change
  }
  current_opaque_set: {
    label: "current opaque output\ntoday: 3 channels used\n(color + roughness + metallic)"
    class: do_not_change
  }
  udm_attributes -> current_opaque_set {class: do_not_change}
  udm_attributes -> material_conversion_map {class: to_modify}
  ```

- *Avoid `style.fill` on nodes and containers.* Hard-coded fill colors override D2 themes, making diagrams look inconsistent when the theme changes. Rely on `class` definitions and the theme's palette instead. Use `style.stroke` (via classes) to distinguish elements — the theme will handle background colors.

- *Don't repeat style properties inline when a class already covers them.* If a class file defines the color and stroke, applying those same values inline is redundant and creates two sources of truth.
  ```d2
  # Wrong — inline style duplicates what `new` already provides
  foo -> bar: "added call" {
    style.stroke: LimeGreen
    style.font-color: LimeGreen
  }

  # Correct — class handles the styling
  foo -> bar: "added call" {class: new}
  ```
  If a node needs styling from two classes at once (e.g. shape from one, color from another), use the multi-class syntax: `class: [op; highlight]`.

- *`highlight` is for debugging concerns, not error paths.* The `highlight` class (Crimson) signals something that needs developer attention — a bug, an unresolved issue, an orphaned class. Don't use it just because a node represents an exception or failure state; those are expected behavior and should use `new`, `modified`, or `existing` depending on whether the PR introduced them:
  ```d2
  # Wrong — AssertionError is expected behavior, not a debug concern
  assert_fail: {
    label: "AssertionError (linked mesh)"
    class: [op; highlight]
  }

  # Correct — it's new behavior introduced by this PR
  assert_fail: {
    label: "AssertionError (linked mesh)"
    class: [op; new]
  }
  ```

- *`highlight` is a temporary locator aid, not a permanent diagram element.* `highlight` (Crimson) exists to help a developer *find* a specific node while working — a "you are here" marker you add, act on, and then remove. It should not be baked into a committed diagram as a way to say "this node is important" or "this is the concerning part." Convey permanent meaning with the semantic classes instead (`new`, `modified`, `removed`, `existing`), and let edges/notes carry the reasoning. If you catch yourself leaving `highlight` on nodes in a finished diagram, replace it:
  ```d2
  # Wrong — highlight left on nodes to mark them as "the important ones"
  clone_dialog: "Clone Project dialog" { class: highlight }
  mutation:     "Backend clone mutation" { class: highlight }

  # Correct — use semantic classes; a red `removed` node + a note explains the concern
  clone_dialog: "Clone Project dialog" { class: existing }
  mutation:     "Backend clone mutation" { class: removed }
  ```

- *Dollar signs in labels must be escaped as `\$`.* D2 treats `$` as the start of a substitution expression — any `$` not followed by `{` causes a compile error: `substitutions must begin on {`. Escape every literal `$` in node labels and edge labels with a backslash:
  ```d2
  # Wrong — D2 tries to parse $EnvVars as a substitution and fails
  my_node: "propagate value into $EnvVars array" {class: modified}

  # Correct — backslash escapes the dollar sign
  my_node: "propagate value into \$EnvVars array" {class: modified}
  ```
  This most commonly surfaces with PowerShell variable names (`$EnvVars`, `$Env:PATH`), shell variable references, and TypeScript template literal descriptions copied from code.

- *Dots in identifiers must be escaped.* D2 uses `.` as a path separator, so any literal dots in node/method names (e.g. `...` for variadic args, or `e.g.` in labels) must be escaped as `\.`:
  ```d2
  # Wrong — D2 interprets the dots as a nested path
  MyClass: {
    shape: class
    -__process(...)
  }

  # Correct — escape the dots
  MyClass: {
    shape: class
    -__process(\.\.\.)
  }
  ```

- *Use underscore prefixes for node IDs.* D2 reserves words like `label`, `shape`, `style`, `class`, `near`, and `direction` as property keys — using them bare as node IDs causes silent misbehaviour. Prefixing with `_` sidesteps the reserved-word problem entirely. As a byproduct, it also makes broken path references visible in rendered diagrams:
  ```d2
  # Convention: underscore prefix for all node IDs
  _foo: {
    label: Foo
  }

  _bar: Bar

  # Wrong path - shows "_foo" in diagram (underscore visible = bug indicator)
  _bar -> _wrong._path._to._foo

  # Correct path - shows "Foo" label (no underscore = working reference)
  _bar -> _right._path._to._foo
  ```
  This convention helps debugging because if you see an underscore-prefixed ID in the rendered diagram, it indicates an incorrect path reference. Correct paths resolve to the node's label.

This app will be going through a number of phases.

## Phases

### Manual Phase (Current)

The current "manual d2" phase of this app is meant to set a useful standard of quality for future phases.  

For example, **inter-service** diagrams that describe how platform-api, redis, temporal, and the auto services interact provide contexts that IDEs, coding agents, and other tools do not. The inter-service layer is:  

* high level - meaning relevant to architecture, system design, or management-level task allocation, etc...
* medium level - meaning teams need to match each other's efforts in mapping data models across services
* low volume - meaning there are relatively few inter-service interactions to document
* unique in purpose - meaning IDEs, coding assistants, confluence pages, and Jira tasks often lack these details

Because of their level and uniqueness, aesthetic is important. Because of their low volume, good aesthetic is achievable. It's important that a standard for readable aesthetic be established in the Manual d2 phase of the diagrams project so it isn't lost in chaos when the dynamic phase opens the visuals up to the chaos of code-reporting tools.  

Some services are highly intertwined. Diagrams describing their relationship are  

* medium level - meaning they serve to determine in theory whether an idea can be implemented
* low level - meaning they map specific classes and methods to each other
* high volume - meaning there are many operations to map across services
* unique in purpose - meaning not redundant to IDE plugins or coding agents.

The Manual d2 phase will struggle to comprehensively cover these relationships in the main branch, and will have little or no hope of keeping up with hypothetically considered changes. This phase must determine how to depict these not with detail, but via pattern, after which the dynamic phase will be able to keep up both with the main branch, branches in development, concrete plans, and hypothetical designs.  

A relatively pure **intra-service** example is the relationship between the contents of the `controllers/` and `external-services/` folders within `hi/backend/platform-api/src`. Diagrams at this level are: 

* too low-level for architectural planning, system design, management-level planning
* too high-volume for comprehensive manual diagramming
* redundant to IDEs, coding agents, and coding skillsets during feature development

However, they are still relevant to identifying and resolving technical debt. For example, VSCode, Sonar, and Copilot do not prevent duplicate helper functions across files, nor of unmaintainable class inheritence, nor of over-engineering in general, and in fact these are signatures of coding agents.  

Although they're too low-level for comprehensive manual diagramming, intra-service examples must be manually defined before dynamically constructing them, as the noise of dynamic code-reading tools would undermine the purpose of the diagrams.  

### MCP Phase

The MCP (Model Context Protocol) phase will allow AI coding assistants to query for relevant links between services. By providing clean, precise, up-to-date context, it will reduce the redundancies, circularities, and inefficiencies that plague current AI assistance.

AI faces the same reasoning tradeoffs as humans - using semantic pattern matching rather than formal logic, with working memory limits and training data biases. MCP gives AI the same advantage that good documentation gives human developers.

Since pointers.yaml links multiple portions of source code to single diagrams (and vice versa), it serves as an easily-parsable map across services. The MCP's initial design is simple: receive a query about a code location, return linked locations and their relationships.

**For a detailed example** of why this matters and how it works, see [docs/mcp-reasoning-example.md](docs/mcp-reasoning-example.md).

### Agentic Phase
