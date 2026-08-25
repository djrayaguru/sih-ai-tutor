import { useState, useEffect } from 'react'
import './App.css'
import CircularGauge from './CircularGauge'
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from 'recharts'

function getTopicColor(topic) {
  const t = topic.toLowerCase()
  if (t.includes('linear')) return 'var(--primary)'
  if (t.includes('binomial')) return 'var(--secondary)'
  if (t.includes('probability')) return '#f5bf32'
  return 'var(--text-muted)'
}

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

  const radarData = data.topics.map(t => ({ topic: t.topic, accuracy: 100 - t.struggle_rate }))
  const avgStruggle = Math.round(data.topics.reduce((sum, t) => sum + t.struggle_rate, 0) / data.topics.length)
  const overallAccuracy = 100 - avgStruggle
  const hardestTopic = data.topics[0]

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <h3>Concept Insights</h3>
        <p className="dashboard-note">Where everyone using this app struggles most — live data from the backend, aggregated and anonymous.</p>
      </div>

      <div className="dashboard-grid-3">
        <div className="dashboard-card center-card">
          <h4 className="dashboard-card-title">Overall Accuracy</h4>
          <CircularGauge percentage={overallAccuracy} sublabel="Across everyone" />
        </div>

        <div className="dashboard-card">
          <h4 className="dashboard-card-title">Concept Map</h4>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData} outerRadius="75%">
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="topic" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar dataKey="accuracy" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.3} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="dashboard-card center-card">
          <h4 className="dashboard-card-title">Total Attempts</h4>
          <div className="big-stat-number">{data.total_attempts}</div>
          <p className="dashboard-note" style={{ marginTop: '8px' }}>Toughest: <strong>{hardestTopic.topic}</strong></p>
        </div>
      </div>

      <div className="dashboard-card">
        <h4 className="dashboard-card-title">Struggle rate by topic</h4>
        <p className="dashboard-note">Higher means more people get it wrong</p>
        <div className="accuracy-bars">
          {data.topics.map(t => (
            <div key={t.topic} className="accuracy-bar-row">
              <div className="accuracy-bar-label-row">
                <span className="accuracy-bar-topic">{t.topic}</span>
                <span className="accuracy-bar-pct" style={{ color: getTopicColor(t.topic) }}>{t.struggle_rate}%</span>
              </div>
              <div className="accuracy-bar-track">
                <div className="accuracy-bar-fill" style={{ width: `${t.struggle_rate}%`, background: getTopicColor(t.topic) }}></div>
              </div>
            </div>
          ))}
        </div>
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