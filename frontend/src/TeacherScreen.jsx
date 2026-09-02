import { useState, useEffect } from 'react'
import { API_BASE_URL } from './config'
import './App.css'

function getToken() {
  const user = JSON.parse(localStorage.getItem('tutor-user') || 'null')
  return user?.token || null
}

function authHeaders() {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function UploadMaterialTab() {
  const [subject, setSubject] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState(null)
  const [materials, setMaterials] = useState(null)
  const [loadError, setLoadError] = useState(null)

  function loadMaterials() {
    fetch(`${API_BASE_URL}/api/teacher/materials`, { headers: authHeaders() })
      .then(res => res.json())
      .then(data => {
        if (data.detail) setLoadError(data.detail)
        else setMaterials(data.materials || [])
      })
      .catch(() => setLoadError("Couldn't reach the tutor server."))
  }

  useEffect(loadMaterials, [])

  async function handleUpload(e) {
    e.preventDefault()
    if (!file || !subject.trim()) return
    setUploading(true)
    setMessage(null)

    const formData = new FormData()
    formData.append('subject', subject.trim())
    formData.append('file', file)

    try {
      const res = await fetch(`${API_BASE_URL}/api/teacher/materials/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData
      })
      const data = await res.json()
      if (data.error || data.detail) {
        setMessage({ type: 'error', text: data.error || data.detail })
      } else {
        setMessage({ type: 'success', text: `Added "${data.filename}" to ${data.subject} — ${data.chunks_added} chunks are now searchable by students.` })
        setSubject('')
        setFile(null)
        e.target.reset()
        loadMaterials()
      }
    } catch {
      setMessage({ type: 'error', text: "Couldn't reach the tutor server. Make sure it's running." })
    }
    setUploading(false)
  }

  return (
    <div className="dashboard-card">
      <h4 className="dashboard-card-title">Upload course material</h4>
      <p className="dashboard-note">PDF or TXT. Students can immediately ask about and get quizzed on whatever subject you tag it with.</p>

      <form onSubmit={handleUpload} className="teacher-upload-form">
        <input
          type="text"
          placeholder="Subject (e.g. Trigonometry)"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
        />
        <input
          type="file"
          accept=".pdf,.txt"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          required
        />
        <button type="submit" className="quiz-start-btn" disabled={uploading}>
          {uploading ? 'Uploading & processing...' : 'Upload material'}
        </button>
      </form>

      {message && (
        <p className={message.type === 'error' ? 'modal-error' : 'upload-success-note'}>{message.text}</p>
      )}

      <h4 className="dashboard-card-title" style={{ marginTop: '24px' }}>Your uploaded materials</h4>
      {loadError && <p className="dashboard-note">{loadError}</p>}
      {!loadError && materials === null && <p className="dashboard-note">Loading...</p>}
      {!loadError && materials && materials.length === 0 && <p className="dashboard-note">Nothing uploaded yet.</p>}
      {!loadError && materials && materials.length > 0 && (
        <table className="dashboard-table">
          <thead>
            <tr><th>Subject</th><th>File</th><th>Chunks</th><th>Uploaded</th></tr>
          </thead>
          <tbody>
            {materials.map(m => (
              <tr key={m.id}>
                <td>{m.subject}</td>
                <td>{m.original_filename}</td>
                <td>{m.chunk_count}</td>
                <td>{new Date(m.uploaded_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ClassPerformanceTab() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/teacher/insights`, { headers: authHeaders() })
      .then(res => res.json())
      .then(d => {
        if (d.detail) setError(d.detail)
        else setData(d)
      })
      .catch(() => setError("Couldn't reach the tutor server."))
  }, [])

  if (error) return <div className="dashboard-card"><p className="dashboard-note">{error}</p></div>
  if (!data) return <div className="dashboard-card"><p className="dashboard-note">Loading...</p></div>
  if (data.total_attempts === 0) {
    return <div className="dashboard-card"><p className="dashboard-note">No practice attempts recorded yet across any student.</p></div>
  }

  return (
    <>
      <div className="dashboard-card">
        <h4 className="dashboard-card-title">Weakest topics (class-wide)</h4>
        <table className="dashboard-table">
          <thead><tr><th>Topic</th><th>Attempts</th><th>Struggle rate</th></tr></thead>
          <tbody>
            {data.topics.map((t, i) => (
              <tr key={i}><td>{t.topic}</td><td>{t.attempts}</td><td>{t.struggle_rate}%</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dashboard-card">
        <h4 className="dashboard-card-title">Per-student breakdown</h4>
        <p className="dashboard-note">Lowest accuracy first — where to check in first.</p>
        <table className="dashboard-table">
          <thead><tr><th>Student</th><th>Attempts</th><th>Accuracy</th><th>Weakest topic</th></tr></thead>
          <tbody>
            {data.students.map((s, i) => (
              <tr key={i}>
                <td>{s.name || s.student_id}</td>
                <td>{s.attempts}</td>
                <td>{s.accuracy}%</td>
                <td>{s.weakest_topic || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function TeacherScreen() {
  const [tab, setTab] = useState('upload')

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <h3>Teacher Portal</h3>
        <p className="dashboard-note">Upload the material students learn from, and see where your class is struggling.</p>
      </div>

      <div className="teacher-tabs">
        <button className={tab === 'upload' ? 'teacher-tab active' : 'teacher-tab'} onClick={() => setTab('upload')}>Upload Material</button>
        <button className={tab === 'performance' ? 'teacher-tab active' : 'teacher-tab'} onClick={() => setTab('performance')}>Class Performance</button>
      </div>

      {tab === 'upload' ? <UploadMaterialTab /> : <ClassPerformanceTab />}
    </div>
  )
}

export default TeacherScreen
