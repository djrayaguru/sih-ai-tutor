import { useState } from 'react'
import './App.css'

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

function formatRelativeDate(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays} days ago`
}

const FEATURES = [
  { id: 'chat', icon: 'chat_bubble', title: 'Start Chatting', subtitle: 'Ask questions & get help.', color: 'indigo' },
  { id: 'practice', icon: 'quiz', title: 'Take a Quiz', subtitle: 'Test your knowledge.', color: 'coral' },
  { id: 'dashboard', icon: 'grid_view', title: 'My Dashboard', subtitle: 'View your progress.', color: 'teal' },
  { id: 'insights', icon: 'insights', title: 'Learning Insights', subtitle: 'See class-wide trends.', color: 'gold' },
]

function HomeScreen({ user, onNavigate }) {
  const [log] = useState(loadLog())

  const topicMap = {}
  log.forEach(entry => {
    if (!topicMap[entry.topic]) topicMap[entry.topic] = { attempts: 0, correct: 0, lastTimestamp: entry.timestamp }
    topicMap[entry.topic].attempts += 1
    if (entry.correct) topicMap[entry.topic].correct += 1
    if (entry.timestamp > topicMap[entry.topic].lastTimestamp) topicMap[entry.topic].lastTimestamp = entry.timestamp
  })

  const topicData = Object.entries(topicMap).map(([topic, stats]) => ({
    topic,
    accuracy: Math.round((stats.correct / stats.attempts) * 100),
    attempts: stats.attempts,
    lastTimestamp: stats.lastTimestamp
  }))

  const recentTopics = [...topicData].sort((a, b) => b.lastTimestamp - a.lastTimestamp).slice(0, 2)
  const weakTopics = [...topicData].sort((a, b) => a.accuracy - b.accuracy).slice(0, 2)
  const mostRecent = recentTopics[0]
  const firstName = user ? user.name.split(' ')[0] : null

  return (
    <div className="home-page">
      <div className="home-hero">
        <div className="home-hero-text">
          <h2 className="home-hero-title">{firstName ? `Welcome back, ${firstName}.` : 'Ready to learn?'}</h2>
          <p className="home-hero-subtitle">
            {mostRecent
              ? <>You're making progress in <strong>{mostRecent.topic}</strong>. Ready to pick up where you left off, or start something new?</>
              : 'Ask a question, try a quiz, or check your progress below.'}
          </p>
          <button className="home-hero-btn" onClick={() => onNavigate(mostRecent ? 'practice' : 'chat')}>
            <span className="material-symbols-outlined">play_arrow</span>
            {mostRecent ? `Continue ${mostRecent.topic}` : 'Start Session'}
          </button>
        </div>
        <div className="home-hero-art">
          <span className="material-symbols-outlined">school</span>
        </div>
      </div>

      <div className="home-feature-grid">
        {FEATURES.map(f => (
          <button key={f.id} className="home-feature-card" onClick={() => onNavigate(f.id)}>
            <div className={`home-feature-icon icon-${f.color}`}>
              <span className="material-symbols-outlined">{f.icon}</span>
            </div>
            <div className="home-feature-title">{f.title}</div>
            <div className="home-feature-subtitle">{f.subtitle}</div>
          </button>
        ))}
      </div>

      <div className="home-bottom-grid">
        <div className="home-card">
          <div className="home-card-header">
            <h4 className="home-card-title">Recent Activity</h4>
            <button className="home-view-all" onClick={() => onNavigate('dashboard')}>View All</button>
          </div>

          {recentTopics.length === 0 ? (
            <p className="dashboard-note">No activity yet — try a practice question to get started.</p>
          ) : (
            recentTopics.map(t => (
              <div key={t.topic} className="home-activity-item">
                <div className="home-activity-icon" style={{ background: getTopicColor(t.topic) }}>
                  <span className="material-symbols-outlined">functions</span>
                </div>
                <div className="home-activity-body">
                  <div className="home-activity-title">{t.topic}</div>
                  <div className="home-activity-subtitle">{t.attempts} attempt{t.attempts !== 1 ? 's' : ''} — last practiced {formatRelativeDate(t.lastTimestamp)}</div>
                  <div className="home-activity-bar-row">
                    <div className="accuracy-bar-track"><div className="accuracy-bar-fill" style={{ width: `${t.accuracy}%`, background: getTopicColor(t.topic) }}></div></div>
                    <span className="home-activity-pct">{t.accuracy}%</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="home-card">
          <h4 className="home-card-title">Topics to Review</h4>
          {weakTopics.length === 0 ? (
            <p className="dashboard-note">Nothing to review yet.</p>
          ) : (
            weakTopics.map(t => (
              <div key={t.topic} className="home-review-item">
                <span className="material-symbols-outlined home-review-icon">flag</span>
                <div className="home-review-body">
                  <div className="home-review-title">{t.topic}</div>
                  <div className="home-review-sub">{t.accuracy}% accuracy so far</div>
                </div>
              </div>
            ))
          )}
          <button className="home-add-task-btn" onClick={() => onNavigate('practice')}>
            <span className="material-symbols-outlined">add</span> Practice Now
          </button>
        </div>
      </div>
    </div>
  )
}

export default HomeScreen