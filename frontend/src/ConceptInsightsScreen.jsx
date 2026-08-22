import { useState, useEffect } from 'react'
import './App.css'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function ConceptInsightsScreen() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('http://localhost:8000/api/insights')
      .then(res => res.json())
      .then(setData)
      .catch(() => setError("Couldn't reach the tutor server. Make sure it's running."))
  }, [])

  if (error) {
    return (
      <div className="dashboard-container">
        <h3>Concept Insights</h3>
        <p className="dashboard-note">{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="dashboard-container">
        <h3>Concept Insights</h3>
        <p className="dashboard-note">Loading...</p>
      </div>
    )
  }

  if (data.total_attempts === 0) {
    return (
      <div className="dashboard-container">
        <h3>Concept Insights</h3>
        <p className="dashboard-note">No quiz attempts recorded yet. Once people use Chat quizzes and Practice, struggle patterns will show up here.</p>
      </div>
    )
  }

  const hardestTopic = data.topics[0]

  return (
    <div className="dashboard-container">
      <h3>Concept Insights</h3>
      <p className="dashboard-note">Where everyone using this app struggles most — live data from the backend, aggregated and anonymous.</p>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{data.total_attempts}</div>
          <div className="stat-label">Total attempts logged</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{hardestTopic.topic}</div>
          <div className="stat-label">Toughest topic ({hardestTopic.struggle_rate}% wrong)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.topics.length}</div>
          <div className="stat-label">Topics tracked</div>
        </div>
      </div>

      <h4>Struggle rate by topic</h4>
      <div className="chart-wrapper">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.topics}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="topic" tick={{ fontSize: 12 }} interval={0} />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Bar dataKey="struggle_rate" fill="#4f46e5" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <table className="dashboard-table">
        <thead>
          <tr><th>Topic</th><th>Attempts</th><th>Struggle rate</th></tr>
        </thead>
        <tbody>
          {data.topics.map((t, i) => (
            <tr key={i}>
              <td>{t.topic}</td>
              <td>{t.attempts}</td>
              <td>{t.struggle_rate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default ConceptInsightsScreen