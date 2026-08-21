import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import './App.css'

const KNOWN_TOPICS = ['linear equation', 'binomial theorem', 'probability']

function createEmptySession() {
  return {
    id: Date.now(),
    title: 'New chat',
    messages: [{ sender: 'bot', type: 'normal', text: 'Hi! Try asking me about linear equations, the binomial theorem, or probability — or ask something unrelated to see what happens.' }]
  }
}

function logAttempt(topic, correct, question) {
  const existing = JSON.parse(localStorage.getItem('student-progress-log') || '[]')
  existing.push({ topic, correct, question, timestamp: Date.now() })
  localStorage.setItem('student-progress-log', JSON.stringify(existing))
}

function ChatScreen() {
  const [sessions, setSessions] = useState(() => {
    const saved = localStorage.getItem('tutor-chat-sessions')
    return saved ? JSON.parse(saved) : [createEmptySession()]
  })
  const [activeId, setActiveId] = useState(() => sessions[0].id)
  const [input, setInput] = useState('')
  const [quizDrafts, setQuizDrafts] = useState({})

  useEffect(() => {
    localStorage.setItem('tutor-chat-sessions', JSON.stringify(sessions))
  }, [sessions])

  const activeSession = sessions.find(s => s.id === activeId) || sessions[0]

  function updateActiveMessages(updater) {
    setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, messages: updater(s.messages) } : s))
  }

  async function handleSend() {
    if (input.trim() === '') return
    const query = input
    setInput('')

    setSessions(prev => prev.map(s => {
      if (s.id !== activeSession.id) return s
      const isFirstUserMessage = s.messages.filter(m => m.sender === 'user').length === 0
      return {
        ...s,
        title: isFirstUserMessage ? query.slice(0, 28) : s.title,
        messages: [...s.messages, { sender: 'user', type: 'normal', text: query }, { sender: 'bot', type: 'thinking', text: 'Thinking...' }]
      }
    }))

    try {
      const res = await fetch('http://localhost:8000/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      })
      const data = await res.json()

      if (data.refused) {
        updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'thinking'), { sender: 'bot', type: 'refusal', text: data.answer }])
      } else {
        const cleanedAnswer = data.answer.replace(/\n*\*?\(?Source:[^)]*\)?\*?\s*$/i, '').trim()
        const firstSource = data.sources && data.sources[0]
        const newMsgs = [{
          sender: 'bot', type: 'citation', text: cleanedAnswer,
          source: firstSource ? `${firstSource.source_file}, page ${firstSource.page}` : 'Course material'
        }]
        const lowerQuery = query.toLowerCase()
        const knownTopic = KNOWN_TOPICS.find(t => lowerQuery.includes(t))
        if (knownTopic) newMsgs.push({ sender: 'bot', type: 'offer-quiz', topic: knownTopic })
        updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'thinking'), ...newMsgs])
      }
    } catch {
      updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'thinking'), { sender: 'bot', type: 'refusal', text: "Couldn't reach the tutor server. Make sure it's running (uvicorn api:app --reload --port 8000)." }])
    }
  }

  async function startQuiz(topic) {
    updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'quiz-generating'), { sender: 'bot', type: 'quiz-generating', topic }])
    try {
      const res = await fetch('http://localhost:8000/api/practice/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
      })
      const data = await res.json()
      if (data.error) {
        updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'quiz-generating'), { sender: 'bot', type: 'refusal', text: data.error }])
        return
      }
      updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'quiz-generating'), {
        sender: 'bot', type: 'quiz-open', problem_id: data.problem_id, problem: data.problem, topic: data.topic, difficulty: data.difficulty, answered: false
      }])
    } catch  {
      updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'quiz-generating'), { sender: 'bot', type: 'refusal', text: "Couldn't reach the tutor server to generate a question." }])
    }
  }

  function handleDraftChange(index, value) {
    setQuizDrafts(prev => ({ ...prev, [index]: value }))
  }

  async function handleQuizSubmit(messageIndex) {
    const msg = activeSession.messages[messageIndex]
    const answer = (quizDrafts[messageIndex] || '').trim()
    if (!answer) return

    updateActiveMessages(msgs => msgs.map((m, i) => i === messageIndex ? { ...m, submitting: true } : m))

    try {
      const res = await fetch('http://localhost:8000/api/practice/judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: msg.problem_id, student_answer: answer })
      })
      const data = await res.json()

      if (data.error) {
        updateActiveMessages(msgs => msgs.map((m, i) => i === messageIndex ? { ...m, submitting: false, answered: true, errorMsg: data.error } : m))
        return
      }

      logAttempt(msg.topic, data.correct, msg.problem)
      updateActiveMessages(msgs => msgs.map((m, i) => i === messageIndex ? {
        ...m, submitting: false, answered: true, correct: data.correct, feedback: data.feedback, correctAnswer: data.correct_answer
      } : m))
    } catch  {
      updateActiveMessages(msgs => msgs.map((m, i) => i === messageIndex ? { ...m, submitting: false } : m))
    }
  }

  function handleNewChat() {
    const newSession = createEmptySession()
    setSessions(prev => [newSession, ...prev])
    setActiveId(newSession.id)
  }

  return (
    <div className="chat-layout">
      <div className="chat-sidebar">
        <button className="new-chat-btn" onClick={handleNewChat}>+ New chat</button>
        {sessions.map(s => (
          <div key={s.id} className={s.id === activeSession.id ? 'session-item active' : 'session-item'} onClick={() => setActiveId(s.id)}>
            {s.title}
          </div>
        ))}
      </div>

      <div className="chat-container">
        <div className="messages">
          {activeSession.messages.map((msg, index) => {
            if (msg.type === 'quiz-generating') {
              return <div key={index} className="message bot thinking">Generating a question on {msg.topic}...</div>
            }

            if (msg.type === 'quiz-open') {
              return (
                <div key={index} className="message bot quiz">
                  <div className="quiz-level-tag">{msg.difficulty?.toUpperCase()}</div>
                  <div className="quiz-problem-text">{msg.problem}</div>

                  {!msg.answered ? (
                    <div className="quiz-answer-row">
                      <input
                        type="text"
                        placeholder="Your answer..."
                        value={quizDrafts[index] || ''}
                        onChange={(e) => handleDraftChange(index, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleQuizSubmit(index)}
                        disabled={msg.submitting}
                      />
                      <button onClick={() => handleQuizSubmit(index)} disabled={msg.submitting}>
                        {msg.submitting ? 'Checking...' : 'Submit'}
                      </button>
                    </div>
                  ) : msg.errorMsg ? (
                    <div className="quiz-feedback wrong">
                      <div>{msg.errorMsg}</div>
                      <button className="quiz-start-btn" onClick={() => startQuiz(msg.topic)}>Try another {msg.topic} question →</button>
                    </div>
                  ) : (
                    <div className={`quiz-feedback ${msg.correct ? 'correct' : 'wrong'}`}>
                      <div>{msg.correct ? '✅ Correct!' : '❌ Not quite.'}</div>
                      <div>{msg.feedback}</div>
                      {!msg.correct && <div className="quiz-correct-answer">Correct answer: {msg.correctAnswer}</div>}
                      <button className="quiz-start-btn" onClick={() => startQuiz(msg.topic)}>Try another {msg.topic} question →</button>
                    </div>
                  )}
                </div>
              )
            }

            if (msg.type === 'offer-quiz') {
              return (
                <div key={index} className="message bot offer-quiz">
                  <button className="quiz-start-btn" onClick={() => startQuiz(msg.topic)}>Test my understanding of {msg.topic} →</button>
                </div>
              )
            }

            return (
              <div key={index} className={`message ${msg.sender} ${msg.type}`}>
                <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                  {msg.text}
                </ReactMarkdown>
                {msg.type === 'citation' && <div className="citation-source">📄 Source: {msg.source}</div>}
              </div>
            )
          })}
        </div>
        <div className="input-area">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder="Ask about linear equations, binomial theorem, probability..." />
          <button onClick={handleSend}>Send</button>
        </div>
      </div>
    </div>
  )
}

export default ChatScreen