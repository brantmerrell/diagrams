import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import DiagramViewer from './components/DiagramViewer'
import './App.css'

function App() {
  return (
    <Router>
      <div className="app">
        <div className="app-content">
          <Routes>
            <Route path="/tech" element={<DiagramViewer />} />
            <Route path="/tech/*.d2" element={<DiagramViewer />} />
            <Route path="/tech/*" element={<DiagramViewer />} />
            <Route path="/" element={<Navigate to="/tech" replace />} />
          </Routes>
        </div>
      </div>
    </Router>
  )
}

export default App
