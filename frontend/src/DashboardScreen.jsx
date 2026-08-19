import { useState } from 'react'
import './App.css'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function loadLog() {
  return JSON.parse(localStorage.getItem('student-progress-log') || '[]')
}

function DashboardScreen() {
  const [log] = useState(loadLog())

  if (log.length === 0) {
    return (
      <div className="dashboard-container">
        <h3>Your progress</h3>
        <p className="dashboard-note">You haven't attempted any practice questions yet. Head to the Practice tab to get started!</p>
      </div>
    )
  }

  const topicMap = {}
  log.forEach(entry => {
    if (!topicMap[entry.topic]) topicMap[entry.topic] = { attempts: 0, correct: 0 }
    topicMap[entry.topic].attempts += 1
    if (entry.correct) topicMap[entry.topic].correct += 1
  })

  const topicData = Object.entries(topicMap).map(([topic, stats]) => ({
    topic,
    accuracy: Math.round((stats.correct / stats.attempts) * 100),
    attempts: stats.attempts
  }))

  const totalAttempts = log.length
  const totalCorrect = log.filter(e => e.correct).length
  const overallAccuracy = Math.round((totalCorrect / totalAttempts) * 100)
  const weakest = [...topicData].sort((a, b) => a.accuracy - b.accuracy)[0]
  const strongest = [...topicData].sort((a, b) => b.accuracy - a.accuracy)[0]

  return (
    <div className="dashboard-container">
      <h3>Your progress</h3>
      <p className="dashboard-note">This is your own data — private to your account once login is added.</p>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{totalAttempts}</div>
          <div className="stat-label">Questions attempted</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{overallAccuracy}%</div>
          <div className="stat-label">Overall accuracy</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{strongest.topic}</div>
          <div className="stat-label">Strongest topic</div>
        </div>
      </div>

      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${overallAccuracy}%` }}></div>
      </div>

      <h4>Accuracy by topic</h4>
      <div className="chart-wrapper">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={topicData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="topic" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Bar dataKey="accuracy" fill="#4f46e5" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="dashboard-note">Keep practicing <strong>{weakest.topic}</strong> — that's your lowest accuracy area right now.</p>
    </div>
  )
}

export default DashboardScreen