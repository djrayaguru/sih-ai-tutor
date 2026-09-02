import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { API_BASE_URL } from './config'
import './App.css'

const DEFAULT_TOPICS = [
  { key: 'linear equation', label: 'Linear Equations' },
  { key: 'binomial theorem', label: 'Binomial Theorem' },
  { key: 'probability', label: 'Probability' }
]

const SESSION_LENGTH = 5
const STORAGE_KEY = 'practice-session'

function getStudentId() {
  const user = JSON.parse(localStorage.getItem('tutor-user') || 'null')
  if (user?.email) return user.email
  let anonId = localStorage.getItem('tutor-anon-id')
  if (!anonId) {
    anonId = 'anon-' + Math.random().toString(36).slice(2) + Date.now()
    localStorage.setItem('tutor-anon-id', anonId)
  }
  return anonId
}

function logAttemptLocal(topic, correct, question) {
  const existing = JSON.parse(localStorage.getItem('student-progress-log') || '[]')
  existing.push({ topic, correct, question, timestamp: Date.now() })
  localStorage.setItem('student-progress-log', JSON.stringify(existing))
}

function loadSession() {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved ? JSON.parse(saved) : null
}

function saveSession(session) {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  else localStorage.removeItem(STORAGE_KEY)
}

function MathText({ children }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
      {children}
    </ReactMarkdown>
  )
}

function PracticeScreen({ onAskPrerequisite }) {
  const [session, setSession] = useState(loadSession)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)
    const [showSolution, setShowSolution] = useState(false)
  const [prevIndex, setPrevIndex] = useState(session?.currentIndex)
  const [topics, setTopics] = useState(DEFAULT_TOPICS)

  useEffect(() => {
    // Subjects come from the backend so a teacher's newly uploaded material shows
    // up here without a frontend code change — falls back to the 3 shipped
    // defaults (already shown immediately above) if the fetch fails.
    fetch(`${API_BASE_URL}/api/subjects`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.subjects) && data.subjects.length > 0) {
          setTopics(data.subjects.map(s => ({ key: s.key, label: s.label })))
        }
      })
      .catch(() => { /* keep the defaults already shown */ })
  }, [])

  // Reset showSolution when the question changes, without setState-in-effect.
  if (session?.currentIndex !== prevIndex) {
    setPrevIndex(session?.currentIndex)
    setShowSolution(false)
  }

  useEffect(() => {
    saveSession(session)
  }, [session])

  useEffect(() => {
    if (session && !session.finished && !session.questions[session.currentIndex]) {
      fetchQuestion()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.currentIndex, session?.topic, session?.finished])

  async function fetchQuestion() {
    if (!session) return
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/practice/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: session.topic, student_id: getStudentId() })
      })
      const data = await res.json()
      if (data.error) {
        setErrorMsg(data.error)
        setLoading(false)
        return
      }
      setSession(prev => ({ ...prev, questions: [...prev.questions, data] }))
    } catch {
      setErrorMsg("Couldn't reach the tutor server. Make sure it's running.")
    }
    setLoading(false)
  }

  function handleSelectTopic(topicKey, topicLabel) {
    setErrorMsg(null)
    setSession({
      topic: topicKey,
      topicLabel,
      sessionLength: SESSION_LENGTH,
      currentIndex: 0,
      questions: [],
      answers: [],
      finished: false
    })
  }

  function handleChangeTopic() {
    setSession(null)
    saveSession(null)
    setErrorMsg(null)
  }

  async function handleSelectOption(optionIndex) {
    const currentQuestion = session.questions[session.currentIndex]
    if (session.answers[session.currentIndex]) return

    const correct = optionIndex === currentQuestion.correct_index
    const newAnswers = [...session.answers]
    newAnswers[session.currentIndex] = { selectedIndex: optionIndex, correct, prerequisiteSuggestion: null }
    setSession(prev => ({ ...prev, answers: newAnswers }))

    logAttemptLocal(session.topic, correct, currentQuestion.question)

    try {
      const res = await fetch(`${API_BASE_URL}/api/practice/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: getStudentId(), topic: session.topic, correct, difficulty: currentQuestion.difficulty })
      })
      const data = await res.json()
      if (!correct && data.prerequisite_suggestion) {
        setSession(prev => {
          const updated = [...prev.answers]
          updated[prev.currentIndex] = { ...updated[prev.currentIndex], prerequisiteSuggestion: data.prerequisite_suggestion }
          return { ...prev, answers: updated }
        })
      }
    } catch {
      // logging failure shouldn't block the quiz flow
    }
  }

  function handleNext() {
    const nextIndex = session.currentIndex + 1
    if (nextIndex >= session.sessionLength) {
      setSession(prev => ({ ...prev, finished: true }))
    } else {
      setSession(prev => ({ ...prev, currentIndex: nextIndex }))
    }
  }

  function handleRestart() {
    handleSelectTopic(session.topic, session.topicLabel)
  }

  if (!session) {
    return (
      <div className="practice-container">
        <h3>What do you want to practice?</h3>
        <div className="topic-picker">
          {topics.map(t => (
            <button key={t.key} className="topic-picker-btn" onClick={() => handleSelectTopic(t.key, t.label)}>{t.label}</button>
          ))}
        </div>
      </div>
    )
  }

  if (session.finished) {
    const correctCount = session.answers.filter(a => a && a.correct).length
    return (
      <div className="practice-container">
        <div className="quiz-results">
          <div className="quiz-results-score">{correctCount}/{session.sessionLength}</div>
          <h3>Session complete — {session.topicLabel}</h3>
          <p className="dashboard-note">You got {correctCount} out of {session.sessionLength} correct.</p>
          <div className="quiz-results-actions">
            <button className="quiz-start-btn" onClick={handleRestart}>Practice {session.topicLabel} again</button>
            <button className="change-topic-link" onClick={handleChangeTopic}>← Choose a different topic</button>
          </div>
        </div>
      </div>
    )
  }

  const currentQuestion = session.questions[session.currentIndex]
  const currentAnswer = session.answers[session.currentIndex]

  return (
    <div className="practice-container">
      <div className="quiz-session-header">
        <button className="change-topic-link" onClick={handleChangeTopic}>← Choose a different topic</button>
        <span className="quiz-session-progress">Question {session.currentIndex + 1} of {session.sessionLength}</span>
      </div>

      {errorMsg && (
        <div className="feedback wrong">
          <p>{errorMsg}</p>
          <button onClick={fetchQuestion}>Try again</button>
        </div>
      )}

      {loading && !currentQuestion && <p className="practice-progress">Generating a question...</p>}

      {currentQuestion && (
        <>
          <div className="quiz-level-tag">{currentQuestion.difficulty?.toUpperCase()}</div>
          <h3 className="quiz-math-heading"><MathText>{currentQuestion.question}</MathText></h3>

          <div className="options">
            {currentQuestion.options.map((opt, i) => {
              let cls = 'option'
              if (currentAnswer) {
                if (i === currentQuestion.correct_index) cls += ' correct'
                else if (i === currentAnswer.selectedIndex) cls += ' wrong'
              }
              return (
                <button key={i} className={cls} disabled={!!currentAnswer} onClick={() => handleSelectOption(i)}>
                  <MathText>{opt}</MathText>
                </button>
              )
            })}
          </div>

          {currentAnswer && (
            <div className={`feedback ${currentAnswer.correct ? 'correct' : 'wrong'}`}>
              <p>{currentAnswer.correct ? '✅ Correct!' : '❌ Not quite.'}</p>
              {currentQuestion.explanation && <div className="quiz-math-explanation"><MathText>{currentQuestion.explanation}</MathText></div>}
              {currentQuestion.solution && (
                <>
                  <button className="solution-toggle-btn" onClick={() => setShowSolution(prev => !prev)}>
                    {showSolution ? 'Hide full solution' : 'See full worked solution'}
                  </button>
                  {showSolution && <div className="solution-box"><MathText>{currentQuestion.solution}</MathText></div>}
                </>
              )}
              {currentAnswer.prerequisiteSuggestion && (
                <div className="prerequisite-box">
                  <p>💡 This often depends on understanding <strong>{currentAnswer.prerequisiteSuggestion}</strong> — worth reviewing that first.</p>
                  <button onClick={() => onAskPrerequisite(currentAnswer.prerequisiteSuggestion)}>Ask about it in Chat →</button>
                </div>
              )}
              <button onClick={handleNext}>{session.currentIndex + 1 >= session.sessionLength ? 'See results' : 'Next question'}</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default PracticeScreen