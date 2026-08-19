import './App.css'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function loadLog() {
  return JSON.parse(localStorage.getItem('student-progress-log') || '[]')
}

function ConceptInsightsScreen() {
  const log = loadLog()

  if (log.length === 0) {
    return (
      <div className="dashboard-container">
        <h3>Concept Insights</h3>
        <p className="dashboard-note">No quiz attempts recorded yet. Once people use Chat quizzes and Practice, struggle patterns will show up here.</p>
      </div>
    )
  }

  const topicMap = {}
  log.forEach(entry => {
    if (!topicMap[entry.topic]) topicMap[entry.topic] = { attempts: 0, wrong: 0 }
    topicMap[entry.topic].attempts += 1
    if (!entry.correct) topicMap[entry.topic].wrong += 1
  })
  const topicData = Object.entries(topicMap)
    .map(([topic, stats]) => ({ topic, struggleRate: Math.round((stats.wrong / stats.attempts) * 100), attempts: stats.attempts }))
    .sort((a, b) => b.struggleRate - a.struggleRate)

  const questionMap = {}
  log.forEach(entry => {
    const key = entry.question || `${entry.topic} (unspecified question)`
    if (!questionMap[key]) questionMap[key] = { topic: entry.topic, attempts: 0, wrong: 0 }
    questionMap[key].attempts += 1
    if (!entry.correct) questionMap[key].wrong += 1
  })
  const questionData = Object.entries(questionMap)
    .map(([question, stats]) => ({ question, topic: stats.topic, missRate: Math.round((stats.wrong / stats.attempts) * 100), attempts: stats.attempts }))
    .sort((a, b) => b.missRate - a.missRate)
    .slice(0, 5)

  const totalAttempts = log.length
  const hardestTopic = topicData[0]
  const hardestQuestion = questionData[0]

  return (
    <div className="dashboard-container">
      <h3>Concept Insights</h3>
      <p className="dashboard-note">Where everyone using this app struggles most — aggregated, anonymous, focused on concepts rather than individuals.</p>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{totalAttempts}</div>
          <div className="stat-label">Total attempts logged</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{hardestTopic.topic}</div>
          <div className="stat-label">Toughest topic ({hardestTopic.struggleRate}% wrong)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{hardestQuestion ? `${hardestQuestion.missRate}%` : '—'}</div>
          <div className="stat-label">Miss rate on hardest question</div>
        </div>
      </div>

      <h4>Struggle rate by topic</h4>
      <div className="chart-wrapper">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={topicData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="topic" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Bar dataKey="struggleRate" fill="#4f46e5" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h4>Most-missed questions</h4>
      <table className="dashboard-table">
        <thead>
          <tr><th>Question</th><th>Topic</th><th>Attempts</th><th>Miss rate</th></tr>
        </thead>
        <tbody>
          {questionData.map((q, i) => (
            <tr key={i}>
              <td>{q.question}</td>
              <td>{q.topic}</td>
              <td>{q.attempts}</td>
              <td>{q.missRate}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="dashboard-note" style={{ marginTop: '16px' }}>
        This reflects attempts recorded in this browser right now. Once accounts sync attempts to a shared database, this becomes real across every student.
      </p>
    </div>
  )
}

export default ConceptInsightsScreen