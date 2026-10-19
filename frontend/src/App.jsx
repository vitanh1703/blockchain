import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(setHealth)
      .catch((err) => setError(err.message))
  }, [])

  return (
    <section id="center">
      <h1>Node.js + React</h1>
      <p>
        Sửa <code>frontend/src/App.jsx</code> và <code>backend/src/index.js</code> để bắt đầu.
      </p>
      <p>
        Backend:{' '}
        {error ? `lỗi kết nối (${error})` : health ? health.message : 'đang kết nối...'}
      </p>
    </section>
  )
}

export default App
