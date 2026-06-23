import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import ManualDiagramViewer from './components/ManualDiagramViewer'
import './App.css'

function App() {
  return (
    <Router>
      <div className="app">
        <div className="app-content">
          <Routes>
            <Route path="/manual" element={<ManualDiagramViewer />} />
            <Route path="/manual/*.d2" element={<ManualDiagramViewer />} />
            <Route path="/manual/*" element={<ManualDiagramViewer />} />
            <Route path="/" element={<Navigate to="/manual" replace />} />
          </Routes>
        </div>
      </div>
    </Router>
  )
}

export default App
