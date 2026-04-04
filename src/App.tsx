import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import DiagramViewer from './components/DiagramViewer'
import './App.css'

function App() {
  return (
    <Router>
      <div className="app">
        <Routes>
          <Route path="/" element={<DiagramViewer />} />
          <Route path="/diagram/:name" element={<DiagramViewer />} />
          <Route path="/diagram/*" element={<DiagramViewer />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App
