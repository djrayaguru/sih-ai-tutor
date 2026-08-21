import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import './App.css'

const quizBank = {
  'linear equation': {
    easy: [
      { question: 'What is the general form of a linear equation in two variables?', options: ['Ax + By + C = 0', 'Ax^2 + B = 0', 'A/x + B/y = 0', 'Ax + B = C^2'], correctIndex: 0 },
      { question: 'How many variables does a linear equation in two variables have?', options: ['One', 'Two', 'Three', 'It varies'], correctIndex: 1 }
    ],
    medium: [
      { question: 'If 2x + 3y = 6, what is y when x = 0?', options: ['y = 0', 'y = 1', 'y = 2', 'y = 3'], correctIndex: 2 },
      { question: 'How many solutions does a linear equation in two variables have?', options: ['Exactly one', 'Exactly two', 'None', 'Infinitely many'], correctIndex: 3 }
    ],
    hard: [
      { question: 'Geometrically, what does it mean when two linear equations have no common solution?', options: ['The lines are parallel', 'The lines are perpendicular', 'The lines are identical', 'The lines intersect twice'], correctIndex: 0 },
      { question: 'When do two linear equations in two variables have a unique solution?', options: ['When the lines are parallel', 'When the lines coincide', 'When the lines intersect at exactly one point', 'Never'], correctIndex: 2 }
    ]
  },
  'binomial theorem': {
    easy: [
      { question: 'What does the Binomial Theorem help you do?', options: ['Solve quadratic equations', 'Expand expressions like (a+b)^n', 'Find derivatives', 'Calculate probability'], correctIndex: 1 },
      { question: 'In (a+b)^n, what is "n" called?', options: ['The base', 'The coefficient', 'The index or exponent', 'The remainder'], correctIndex: 2 }
    ],
    medium: [
      { question: 'What is the general term in a binomial expansion usually denoted as?', options: ['T(n)', 'T(r+1)', 'T(0)', 'T(a+b)'], correctIndex: 1 },
      { question: 'The numbers multiplying each term in a binomial expansion are called:', options: ['Binomial coefficients', 'Linear coefficients', 'Prime factors', 'Exponential terms'], correctIndex: 0 }
    ],
    hard: [
      { question: 'What is the sum of all binomial coefficients in the expansion of (1+x)^n?', options: ['n', '2n', '2^n', 'n^2'], correctIndex: 2 },
      { question: 'A single middle term exists in a binomial expansion when n is:', options: ['Odd', 'Even', 'Zero', 'Negative'], correctIndex: 1 }
    ]
  },
  'probability': {
    easy: [
      { question: 'The probability of any event lies between:', options: ['-1 and 1', '0 and 1', '1 and 10', '0 and 100'], correctIndex: 1 },
      { question: 'What is the probability of a certain (sure) event?', options: ['0', '0.5', '1', 'Cannot be determined'], correctIndex: 2 }
    ],
    medium: [
      { question: 'If P(A) = 0.3, what is P(not A)?', options: ['0.3', '0.7', '1.3', '0'], correctIndex: 1 },
      { question: 'The basic formula for probability of an event is:', options: ['Total outcomes / favorable outcomes', 'Favorable outcomes / total outcomes', 'Favorable outcomes × total outcomes', 'Total outcomes - favorable outcomes'], correctIndex: 1 }
    ],
    hard: [
      { question: 'For two mutually exclusive events A and B, P(A or B) equals:', options: ['P(A) × P(B)', 'P(A) − P(B)', 'P(A) + P(B)', 'P(A) / P(B)'], correctIndex: 2 },
      { question: 'If two fair dice are rolled, how many total possible outcomes are there?', options: ['6', '12', '24', '36'], correctIndex: 3 }
    ]
  }
}

const levelOrder = ['easy', 'medium', 'hard']
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
  const [activeQuiz, setActiveQuiz] = useState(null)

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

  function startQuiz(topic) {
    const question = quizBank[topic].easy[0]
    setActiveQuiz({ topic, level: 'easy', attempt: 1 })
    updateActiveMessages(msgs => [...msgs, { sender: 'bot', type: 'quiz-question', topic, level: 'easy', ...question, answered: false }])
  }

  function handleQuizAnswer(messageIndex, selectedIndex) {
    const quizMsg = activeSession.messages[messageIndex]
    const isCorrect = selectedIndex === quizMsg.correctIndex
    const currentAttemptInfo = activeQuiz

    updateActiveMessages(msgs => msgs.map((m, i) => i === messageIndex ? { ...m, answered: true, selectedIndex } : m))
    logAttempt(quizMsg.topic, isCorrect, quizMsg.question)

    setTimeout(() => {
      if (isCorrect) {
        const currentLevelIndex = levelOrder.indexOf(quizMsg.level)
        if (currentLevelIndex === levelOrder.length - 1) {
          updateActiveMessages(msgs => [...msgs, { sender: 'bot', type: 'quiz-complete', text: `🎉 Great work — you've mastered ${quizMsg.topic} up to hard level!` }])
          setActiveQuiz(null)
        } else {
          const nextLevel = levelOrder[currentLevelIndex + 1]
          const nextQuestion = quizBank[quizMsg.topic][nextLevel][0]
          updateActiveMessages(msgs => [...msgs, { sender: 'bot', type: 'quiz-question', topic: quizMsg.topic, level: nextLevel, ...nextQuestion, answered: false }])
          setActiveQuiz({ topic: quizMsg.topic, level: nextLevel, attempt: 1 })
        }
      } else {
        if (currentAttemptInfo && currentAttemptInfo.attempt === 1) {
          const retryQuestion = quizBank[quizMsg.topic][quizMsg.level][1]
          updateActiveMessages(msgs => [
            ...msgs,
            { sender: 'bot', type: 'quiz-retry-note', text: `Not quite — let's try another ${quizMsg.level} question on ${quizMsg.topic}.` },
            { sender: 'bot', type: 'quiz-question', topic: quizMsg.topic, level: quizMsg.level, ...retryQuestion, answered: false }
          ])
          setActiveQuiz({ topic: quizMsg.topic, level: quizMsg.level, attempt: 2 })
        } else {
          updateActiveMessages(msgs => [...msgs, { sender: 'bot', type: 'quiz-complete', text: `That's okay — ${quizMsg.topic} (${quizMsg.level} level) has been added to your topics to review.` }])
          setActiveQuiz(null)
        }
      }
    }, 500)
  }

  function handleNewChat() {
    const newSession = createEmptySession()
    setSessions(prev => [newSession, ...prev])
    setActiveId(newSession.id)
    setActiveQuiz(null)
  }

  return (
    <div className="chat-layout">
      <div className="chat-sidebar">
        <button className="new-chat-btn" onClick={handleNewChat}>+ New chat</button>
        {sessions.map(s => (
          <div key={s.id} className={s.id === activeSession.id ? 'session-item active' : 'session-item'} onClick={() => { setActiveId(s.id); setActiveQuiz(null) }}>
            {s.title}
          </div>
        ))}
      </div>

      <div className="chat-container">
        <div className="messages">
          {activeSession.messages.map((msg, index) => {
            if (msg.type === 'quiz-question') {
              return (
                <div key={index} className="message bot quiz">
                  <div className="quiz-level-tag">{msg.level.toUpperCase()}</div>
                  <div>{msg.question}</div>
                  <div className="quiz-options">
                    {msg.options.map((opt, i) => {
                      let cls = 'quiz-option'
                      if (msg.answered) {
                        if (i === msg.correctIndex) cls += ' correct'
                        else if (i === msg.selectedIndex) cls += ' wrong'
                      }
                      return (
                        <button key={i} className={cls} disabled={msg.answered} onClick={() => handleQuizAnswer(index, i)}>
                          {opt}
                        </button>
                      )
                    })}
                  </div>
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