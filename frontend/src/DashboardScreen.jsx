import { useState } from 'react'
import './App.css'
import CircularGauge from './CircularGauge'
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from 'recharts'

function loadLog() {
  return JSON.parse(localStorage.getItem('student-progress-log') || '[]')
}

function getTopicColor(topic) {
  const t = topic.toLowerCase()
  if (t.includes('linear')) return 'var(--primary)'
  if (t.includes('binomial')) return 'var(--secondary)'
  if (t.includes('probability')) return '#f5bf32'
  return 'var(--text-muted)'
}

function calculateStreak(log) {
  if (log.length === 0) return 0
  const dateStrings = new Set(log.map(e => new Date(e.timestamp).toDateString()))
  let streak = 0
  let cursor = new Date()
  if (!dateStrings.has(cursor.toDateString())) {
    cursor.setDate(cursor.getDate() - 1)
  }
  while (dateStrings.has(cursor.toDateString())) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function buildActivityStrip(log) {
  const dateStrings = new Set(log.map(e => new Date(e.timestamp).toDateString()))
  const today = new Date()
  const days = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    days.push({
      dayNum: d.getDate(),
      hasActivity: dateStrings.has(d.toDateString()),
      isToday: d.toDateString() === today.toDateString()
    })
  }
  return days
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
  })).sort((a, b) => b.accuracy - a.accuracy)

  const totalAttempts = log.length
  const totalCorrect = log.filter(e => e.correct).length
  const overallAccuracy = Math.round((totalCorrect / totalAttempts) * 100)
  const weakest = [...topicData].sort((a, b) => a.accuracy - b.accuracy)[0]
  const streak = calculateStreak(log)
  const activityStrip = buildActivityStrip(log)

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <h3>Your Progress</h3>
        <p className="dashboard-note">This is your own data — private to your account once login is added.</p>
      </div>

      <div className="dashboard-grid-3">
        <div className="dashboard-card center-card">
          <h4 className="dashboard-card-title">Overall Mastery</h4>
          <CircularGauge percentage={overallAccuracy} sublabel={overallAccuracy >= 70 ? 'Proficient' : overallAccuracy >= 40 ? 'Improving' : 'Needs work'} />
        </div>

        <div className="dashboard-card">
          <h4 className="dashboard-card-title">Strength Map</h4>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={topicData} outerRadius="75%">
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="topic" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar dataKey="accuracy" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.3} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="dashboard-card">
          <div className="streak-header">
            <h4 className="dashboard-card-title">Learning Streak</h4>
            <div className="streak-badge-pill">🔥 {streak} {streak === 1 ? 'Day' : 'Days'}</div>
          </div>
          <div className="activity-strip">
            {activityStrip.map((d, i) => (
              <div key={i} className={`activity-dot ${d.hasActivity ? 'active' : ''} ${d.isToday ? 'today' : ''}`} title={d.hasActivity ? 'Practiced' : 'No activity'}>
                {d.dayNum}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="dashboard-card">
        <h4 className="dashboard-card-title">Topic Accuracy</h4>
        <p className="dashboard-note">Based on your practice attempts</p>
        <div className="accuracy-bars">
          {topicData.map(t => (
            <div key={t.topic} className="accuracy-bar-row">
              <div className="accuracy-bar-label-row">
                <span className="accuracy-bar-topic">{t.topic}</span>
                <span className="accuracy-bar-pct" style={{ color: getTopicColor(t.topic) }}>{t.accuracy}%</span>
              </div>
              <div className="accuracy-bar-track">
                <div className="accuracy-bar-fill" style={{ width: `${t.accuracy}%`, background: getTopicColor(t.topic) }}></div>
              </div>
            </div>
          ))}
        </div>
        <p className="dashboard-note" style={{ marginTop: '16px' }}>Keep practicing <strong>{weakest.topic}</strong> — that's your lowest accuracy area right now.</p>
      </div>
    </div>
  )
}

export default DashboardScreen