interface CodeViewProps {
  code: string
}

const CodeView: React.FC<CodeViewProps> = ({ code }) => (
  <pre className="code-view">
    <code>{code}</code>
  </pre>
)

export default CodeView
