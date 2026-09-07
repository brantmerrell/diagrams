import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import DiagramViewer from './components/DiagramViewer'
import './App.css'

function App() {
  return (
    <Router>
      <div className="app">
        <div className="app-content">
          <Routes>
            {/* Diagram URLs are the diagram's repo-relative path — no fixed
                prefix, any top-level directory is equally routable. The bare
                "/" root (matched here by the wildcard too) is the landing
                route: DiagramViewer loads the first diagram from
                pointers.yaml for it. */}
            <Route path="/*" element={<DiagramViewer />} />
          </Routes>
        </div>
      </div>
    </Router>
  )
}

export default App
