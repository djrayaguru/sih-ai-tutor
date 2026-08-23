import { useState } from 'react'
import './App.css'

const TOPICS = [
  { key: 'linear equation', label: 'Linear Equations' },
  { key: 'binomial theorem', label: 'Binomial Theorem' },
  { key: 'probability', label: 'Probability' }
]

function logAttempt(topic, correct, question) {
  const existing = JSON.parse(localStorage.getItem('student-progress-log') || '[]')
  existing.push({ topic, correct, question, timestamp: Date.now() })
  localStorage.setItem('student-progress-log', JSON.stringify(existing))
}

function PracticeScreen() {
  const [topic, setTopic] = useState(null)
  const [problem, setProblem] = useState(null)
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  async function fetchProblem(t) {
    setLoading(true)
    setFeedback(null)
    setAnswer('')
    setErrorMsg(null)
    try {
      const res = await fetch('http://localhost:8000/api/practice/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: t })
      })
      const data = await res.json()
      if (data.error) {
        setErrorMsg(data.error)
        setProblem(null)
      } else {
        setProblem(data)
      }
    } catch  {
      setErrorMsg("Couldn't reach the tutor server. Make sure it's running.")
      setProblem(null)
    }
    setLoading(false)
  }

  function handleSelectTopic(t) {
    setTopic(t)
    fetchProblem(t)
  }

  function handleChangeTopic() {
    setTopic(null)
    setProblem(null)
    setFeedback(null)
    setErrorMsg(null)
  }

  async function handleSubmit() {
    if (!answer.trim() || !problem) return
    setSubmitting(true)
    try {
      const res = await fetch('http://localhost:8000/api/practice/judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: problem.problem_id, student_answer: answer })
      })
      const data = await res.json()
      if (data.error) {
        setErrorMsg(data.error)
      } else {
        logAttempt(topic, data.correct, problem.problem)
        setFeedback(data)
      }
    } catch {
      setErrorMsg("Couldn't reach the tutor server to check your answer.")
    }
    setSubmitting(false)
  }

  // Topic picker
  if (!topic) {
    return (
      <div className="practice-container">
        <h3>What do you want to practice?</h3>
        <div className="topic-picker">
          {TOPICS.map(t => (
            <button key={t.key} className="topic-picker-btn" onClick={() => handleSelectTopic(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="practice-container">
      <button className="change-topic-link" onClick={handleChangeTopic}>← Choose a different topic</button>

      {loading && <p className="practice-progress">Generating a question...</p>}

      {errorMsg && (
        <div className="feedback wrong">
          <p>{errorMsg}</p>
          <button onClick={() => fetchProblem(topic)}>Try again</button>
        </div>
      )}

      {problem && !loading && (
        <>
          <div className="quiz-level-tag">{problem.difficulty?.toUpperCase()}</div>
          <h3>{problem.problem}</h3>

          {!feedback ? (
            <div className="quiz-answer-row">
              <input
                type="text"
                placeholder="Type your answer..."
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                disabled={submitting}
              />
              <button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Checking...' : 'Submit'}</button>
            </div>
          ) : (
            <div className={`feedback ${feedback.correct ? 'correct' : 'wrong'}`}>
              <p>{feedback.correct ? '✅ Correct!' : '❌ Not quite.'}</p>
              <p>{feedback.feedback}</p>
              {!feedback.correct && <p><strong>Correct answer:</strong> {feedback.correct_answer}</p>}
              <button onClick={() => fetchProblem(topic)}>Next question</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default PracticeScreen