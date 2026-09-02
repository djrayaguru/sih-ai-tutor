import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { API_BASE_URL } from './config'
import './App.css'

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

function createEmptySession() {
  return {
    id: Date.now(),
    title: 'New chat',
    messages: [{ sender: 'bot', type: 'normal', text: 'Hi! Ask me about any topic your teacher has uploaded material for, or attach a photo of a problem — or ask something unrelated to see what happens.' }]
  }
}

function logAttempt(topic, correct, question) {
  const existing = JSON.parse(localStorage.getItem('student-progress-log') || '[]')
  existing.push({ topic, correct, question, timestamp: Date.now() })
  localStorage.setItem('student-progress-log', JSON.stringify(existing))
}

function MathText({ children }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
      {children}
    </ReactMarkdown>
  )
}

function ChatScreen({ pendingQuestion, onConsumePending }) {
  const [sessions, setSessions] = useState(() => {
    const saved = localStorage.getItem('tutor-chat-sessions')
    return saved ? JSON.parse(saved) : [createEmptySession()]
  })
  const [activeId, setActiveId] = useState(() => sessions[0].id)
  const [input, setInput] = useState('')

  useEffect(() => {
    localStorage.setItem('tutor-chat-sessions', JSON.stringify(sessions))
  }, [sessions])

  useEffect(() => {
    if (pendingQuestion) {
      handleSend(pendingQuestion)
      onConsumePending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion])

  const activeSession = sessions.find(s => s.id === activeId) || sessions[0]

  function updateActiveMessages(updater) {
    setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, messages: updater(s.messages) } : s))
  }

  async function handleSend(overrideText) {
    const query = (overrideText ?? input).trim()
    if (!query) return
    if (!overrideText) setInput('')

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
      const res = await fetch(`${API_BASE_URL}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, student_id: getStudentId() })
      })
      const data = await res.json()

      if (data.refused) {
        updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'thinking'), { sender: 'bot', type: 'refusal', text: data.answer }])
      } else if (data.gated) {
        updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'thinking'), {
          sender: 'bot', type: 'prereq-gate',
          prereqQuestion: data.prereq_question, prereqOptions: data.prereq_options, prereqCorrectIndex: data.prereq_correct_index,
          fullAnswer: data.full_answer, answered: false, selectedIndex: null
        }])
      } else {
        const newMsgs = [{
          sender: 'bot', type: 'answer', text: data.answer,
          awaitingFeedback: data.awaiting_feedback, feedbackResolved: false
        }]
        if (!data.is_followup) newMsgs.push({ sender: 'bot', type: 'offer-quiz', topic: query })
        updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'thinking'), ...newMsgs])
      }
    } catch {
      updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'thinking'), { sender: 'bot', type: 'refusal', text: "Couldn't reach the tutor server. Make sure it's running." }])
    }
  }

  const fileInputRef = useRef(null)

  async function handleFileSelected(e) {
    const file = e.target.files?.[0]
    e.target.value = null
    if (!file) return

    const query = input.trim()
    setInput('')

    setSessions(prev => prev.map(s => {
      if (s.id !== activeSession.id) return s
      const isFirstUserMessage = s.messages.filter(m => m.sender === 'user').length === 0
      return {
        ...s,
        title: isFirstUserMessage ? `📎 ${file.name}` : s.title,
        messages: [
          ...s.messages,
          { sender: 'user', type: 'normal', text: query ? `📎 ${file.name} — ${query}` : `📎 ${file.name}` },
          { sender: 'bot', type: 'thinking', text: 'Looking at your file...' }
        ]
      }
    }))

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('student_id', getStudentId())
      formData.append('query', query)
      const res = await fetch(`${API_BASE_URL}/api/ask/upload`, { method: 'POST', body: formData })
      const data = await res.json()

      if (data.refused) {
        updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'thinking'), { sender: 'bot', type: 'refusal', text: data.answer }])
      } else {
        updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'thinking'), {
          sender: 'bot', type: 'answer', text: data.answer,
          awaitingFeedback: data.awaiting_feedback, feedbackResolved: false
        }])
      }
    } catch {
      updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'thinking'), { sender: 'bot', type: 'refusal', text: "Couldn't reach the tutor server to read that file." }])
    }
  }

  function handlePrereqAnswer(messageIndex, optionIndex) {
    const msg = activeSession.messages[messageIndex]
    if (msg.answered) return
    updateActiveMessages(msgs => msgs.map((m, i) => i === messageIndex ? { ...m, answered: true, selectedIndex: optionIndex } : m))
    setTimeout(() => {
      updateActiveMessages(msgs => [...msgs, { sender: 'bot', type: 'answer', text: msg.fullAnswer, awaitingFeedback: true, feedbackResolved: false }])
    }, 500)
  }

  async function handleFeedback(messageIndex, understood) {
    updateActiveMessages(msgs => msgs.map((m, i) => i === messageIndex ? { ...m, submittingFeedback: true } : m))
    try {
      const res = await fetch(`${API_BASE_URL}/api/ask/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: getStudentId(), understood })
      })
      const data = await res.json()

      updateActiveMessages(msgs => msgs.map((m, i) => i === messageIndex ? { ...m, submittingFeedback: false, feedbackResolved: true } : m))

      if (data.error) {
        updateActiveMessages(msgs => [...msgs, { sender: 'bot', type: 'refusal', text: data.error }])
      } else if (!understood && data.answer) {
        updateActiveMessages(msgs => [...msgs, { sender: 'bot', type: 'answer', text: data.answer, awaitingFeedback: true, feedbackResolved: false }])
      }
    } catch {
      updateActiveMessages(msgs => msgs.map((m, i) => i === messageIndex ? { ...m, submittingFeedback: false } : m))
    }
  }

  async function startQuiz(topic) {
    updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'quiz-generating'), { sender: 'bot', type: 'quiz-generating', topic }])
    try {
      const res = await fetch(`${API_BASE_URL}/api/practice/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, student_id: getStudentId() })
      })
      const data = await res.json()
      if (data.error) {
        updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'quiz-generating'), { sender: 'bot', type: 'refusal', text: data.error }])
        return
      }
      updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'quiz-generating'), {
        sender: 'bot', type: 'quiz-open', topic: data.topic, difficulty: data.difficulty,
        question: data.question, options: data.options, correct_index: data.correct_index,
        explanation: data.explanation, solution: data.solution,
        answered: false, selectedIndex: null, correct: null, prerequisiteSuggestion: null, showSolution: false
      }])
    } catch {
      updateActiveMessages(msgs => [...msgs.filter(m => m.type !== 'quiz-generating'), { sender: 'bot', type: 'refusal', text: "Couldn't reach the tutor server to generate a question." }])
    }
  }

  async function handleQuizAnswer(messageIndex, optionIndex) {
    const msg = activeSession.messages[messageIndex]
    if (msg.answered) return

    const correct = optionIndex === msg.correct_index
    updateActiveMessages(msgs => msgs.map((m, i) => i === messageIndex ? { ...m, answered: true, selectedIndex: optionIndex, correct } : m))
    logAttempt(msg.topic, correct, msg.question)

    try {
      const res = await fetch(`${API_BASE_URL}/api/practice/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: getStudentId(), topic: msg.topic, correct, difficulty: msg.difficulty })
      })
      const data = await res.json()
      if (!correct && data.prerequisite_suggestion) {
        updateActiveMessages(msgs => msgs.map((m, i) => i === messageIndex ? { ...m, prerequisiteSuggestion: data.prerequisite_suggestion } : m))
      }
    } catch {
      // logging failure shouldn't block the UI
    }
  }

  function toggleSolution(messageIndex) {
    updateActiveMessages(msgs => msgs.map((m, i) => i === messageIndex ? { ...m, showSolution: !m.showSolution } : m))
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

            if (msg.type === 'prereq-gate') {
              return (
                <div key={index} className="message bot prereq-gate">
                  <div className="prereq-gate-label">✨ Quick check before we dive in</div>
                  <div className="quiz-problem-text"><MathText>{msg.prereqQuestion}</MathText></div>
                  <div className="quiz-options">
                    {msg.prereqOptions.map((opt, i) => {
                      let cls = 'quiz-option'
                      if (msg.answered) {
                        if (i === msg.prereqCorrectIndex) cls += ' correct'
                        else if (i === msg.selectedIndex) cls += ' wrong'
                      }
                      return (
                        <button key={i} className={cls} disabled={msg.answered} onClick={() => handlePrereqAnswer(index, i)}>
                          <MathText>{opt}</MathText>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            }

            if (msg.type === 'quiz-open') {
              return (
                <div key={index} className="message bot quiz">
                  <div className="quiz-level-tag">{msg.difficulty?.toUpperCase()}</div>
                  <div className="quiz-problem-text"><MathText>{msg.question}</MathText></div>
                  <div className="quiz-options">
                    {msg.options.map((opt, i) => {
                      let cls = 'quiz-option'
                      if (msg.answered) {
                        if (i === msg.correct_index) cls += ' correct'
                        else if (i === msg.selectedIndex) cls += ' wrong'
                      }
                      return (
                        <button key={i} className={cls} disabled={msg.answered} onClick={() => handleQuizAnswer(index, i)}>
                          <MathText>{opt}</MathText>
                        </button>
                      )
                    })}
                  </div>

                  {msg.answered && (
                    <div className={`quiz-feedback ${msg.correct ? 'correct' : 'wrong'}`}>
                      <div>{msg.correct ? '✅ Correct!' : '❌ Not quite.'}</div>
                      {msg.explanation && <div><MathText>{msg.explanation}</MathText></div>}
                      {msg.solution && (
                        <>
                          <button className="solution-toggle-btn" onClick={() => toggleSolution(index)}>
                            {msg.showSolution ? 'Hide full solution' : 'See full worked solution'}
                          </button>
                          {msg.showSolution && <div className="solution-box"><MathText>{msg.solution}</MathText></div>}
                        </>
                      )}
                      {msg.prerequisiteSuggestion && (
                        <div className="prerequisite-box">
                          <p>💡 This often depends on understanding <strong>{msg.prerequisiteSuggestion}</strong> — worth reviewing that first.</p>
                          <button onClick={() => handleSend(`Can you explain ${msg.prerequisiteSuggestion}?`)}>Ask about it →</button>
                        </div>
                      )}
                      <button className="quiz-start-btn" onClick={() => startQuiz(msg.topic)}>Try another {msg.topic} question →</button>
                    </div>
                  )}
                </div>
              )
            }

            if (msg.type === 'offer-quiz') {
              const displayTopic = msg.topic.length > 45 ? msg.topic.slice(0, 45).trim() + '…' : msg.topic
              return (
                <div key={index} className="message bot offer-quiz">
                  <button className="quiz-start-btn" onClick={() => startQuiz(msg.topic)}>Test my understanding of "{displayTopic}" →</button>
                </div>
              )
            }

            if (msg.type === 'answer') {
              return (
                <div key={index} className="message bot answer">
                  <MathText>{msg.text}</MathText>
                  {msg.awaitingFeedback && !msg.feedbackResolved && (
                    <div className="understanding-check">
                      <span>Did that make sense?</span>
                      <button disabled={msg.submittingFeedback} onClick={() => handleFeedback(index, true)}>👍 Yes</button>
                      <button disabled={msg.submittingFeedback} onClick={() => handleFeedback(index, false)}>👎 Not quite</button>
                    </div>
                  )}
                </div>
              )
            }

            return (
              <div key={index} className={`message ${msg.sender} ${msg.type}`}>
                <MathText>{msg.text}</MathText>
              </div>
            )
          })}
        </div>
        <div className="input-area">
          <input type="file" ref={fileInputRef} accept="image/*,.pdf" style={{ display: 'none' }} onChange={handleFileSelected} />
          <button className="attach-file-btn" onClick={() => fileInputRef.current?.click()} title="Upload a photo or PDF" type="button">📎</button>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder="Ask a question, or attach a photo of a problem..." />
          <button onClick={() => handleSend()}>Send</button>
        </div>
      </div>
    </div>
  )
}

export default ChatScreen