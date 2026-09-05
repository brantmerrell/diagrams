import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import DiagramViewer from './components/DiagramViewer'
import './App.css'

function App() {
  return (
    <Router>
      <div className="app">
        <div className="app-content">
          <Routes>
            {/* Diagram URLs are the diagram's repo-relative path, so most live
                under /tech/… but a root-level one (e.g. /class_legend.d2) is
                equally routable. */}
            <Route path="/" element={<Navigate to="/tech" replace />} />
            <Route path="/*" element={<DiagramViewer />} />
          </Routes>
        </div>
      </div>
    </Router>
  )
}

export default App
