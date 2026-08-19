import { useState, useEffect } from 'react'
import './App.css'

const fakeKnowledgeBase = [
  { keyword: 'recursion', answer: 'Recursion is when a function calls itself to solve smaller instances of the same problem.', source: 'Page 12, Unit 3 — Recursion', topicKey: 'recursion' },
  { keyword: 'linked list', answer: 'A linked list is a data structure where each element (node) points to the next one, instead of sitting in one continuous block like an array.', source: 'Page 5, Unit 2 — Data Structures', topicKey: 'linked list' },
  { keyword: 'binary search', answer: 'Binary search finds an item in a sorted list by repeatedly checking the middle element and eliminating half the list each time.', source: 'Page 20, Unit 4 — Searching Algorithms', topicKey: 'binary search' }
]

const quizBank = {
  'recursion': {
    easy: [
      { question: 'What is recursion?', options: ['A loop that never ends', 'A function calling itself to solve a smaller version of the problem', 'A way to sort arrays', 'A type of variable'], correctIndex: 1 },
      { question: 'What must every recursive function have to stop eventually?', options: ['A loop', 'A base case', 'A return type', 'A class'], correctIndex: 1 }
    ],
    medium: [
      { question: 'What happens without a base case?', options: ['Function runs once', 'Infinite recursion until stack overflow', 'Function returns null', 'Nothing, it self-corrects'], correctIndex: 1 },
      { question: 'Each recursive call adds a frame to the:', options: ['Heap', 'Call stack', 'Hash map', 'Database'], correctIndex: 1 }
    ],
    hard: [
      { question: 'Time complexity of naive recursive Fibonacci?', options: ['O(n)', 'O(log n)', 'O(2^n)', 'O(n^2)'], correctIndex: 2 },
      { question: 'Which technique avoids recomputation in recursion?', options: ['Memoization', 'Iteration only', 'Garbage collection', 'Type casting'], correctIndex: 0 }
    ]
  },
  'linked list': {
    easy: [
      { question: 'What does each node store?', options: ['Only data', 'Data and a pointer to the next node', 'An index number', 'A fixed array'], correctIndex: 1 },
      { question: 'The first node of a linked list is called the:', options: ['Root', 'Head', 'Tail', 'Anchor'], correctIndex: 1 }
    ],
    medium: [
      { question: 'The last node usually points to:', options: ['The head', 'Itself', 'null', 'A random node'], correctIndex: 2 },
      { question: 'A key disadvantage of linked lists vs arrays:', options: ['No random access', 'Cannot store numbers', 'Always sorted', 'Uses less memory'], correctIndex: 0 }
    ],
    hard: [
      { question: 'Time complexity of inserting at the head?', options: ['O(n)', 'O(1)', 'O(log n)', 'O(n^2)'], correctIndex: 1 },
      { question: 'In a doubly linked list, each node points to:', options: ['Only next', 'Only previous', 'Both next and previous', 'Nothing'], correctIndex: 2 }
    ]
  },
  'binary search': {
    easy: [
      { question: 'What must be true before binary search works?', options: ['List must be sorted', 'List must be unsorted', 'Even length', 'Only strings'], correctIndex: 0 },
      { question: 'Binary search repeatedly checks:', options: ['The first element', 'The last element', 'The middle element', 'A random element'], correctIndex: 2 }
    ],
    medium: [
      { question: 'Time complexity of binary search?', options: ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], correctIndex: 1 },
      { question: 'If middle < target, search next in the:', options: ['Left half', 'Right half', 'Whole list again', 'Nowhere'], correctIndex: 1 }
    ],
    hard: [
      { question: 'Time complexity of linear search, for comparison?', options: ['O(log n)', 'O(1)', 'O(n)', 'O(n^2)'], correctIndex: 2 },
      { question: 'Binary search can be implemented using:', options: ['Only recursion', 'Only iteration', 'Both recursion and iteration', 'Neither'], correctIndex: 2 }
    ]
  }
}

const levelOrder = ['easy', 'medium', 'hard']

function createEmptySession() {
  return {
    id: Date.now(),
    title: 'New chat',
    messages: [{ sender: 'bot', type: 'normal', text: 'Hi! Try asking me about recursion, linked lists, or binary search — or ask something unrelated to see what happens.' }]
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

  function handleSend() {
    if (input.trim() === '') return
    const query = input.toLowerCase()
    const userMsg = { sender: 'user', type: 'normal', text: input }
    setInput('')

    setSessions(prev => prev.map(s => {
      if (s.id !== activeSession.id) return s
      const isFirstUserMessage = s.messages.filter(m => m.sender === 'user').length === 0
      return { ...s, title: isFirstUserMessage ? input.slice(0, 28) : s.title, messages: [...s.messages, userMsg] }
    }))

    setTimeout(() => {
      const match = fakeKnowledgeBase.find(item => query.includes(item.keyword))
      if (match) {
        updateActiveMessages(msgs => [
          ...msgs,
          { sender: 'bot', type: 'citation', text: match.answer, source: match.source },
          { sender: 'bot', type: 'offer-quiz', topic: match.topicKey }
        ])
      } else {
        updateActiveMessages(msgs => [...msgs, { sender: 'bot', type: 'refusal', text: "I don't have enough information in the course material to answer that confidently." }])
      }
    }, 600)
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
                <div>{msg.text}</div>
                {msg.type === 'citation' && <div className="citation-source">📄 Source: {msg.source}</div>}
              </div>
            )
          })}
        </div>
        <div className="input-area">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder="Ask about recursion, linked lists, binary search..." />
          <button onClick={handleSend}>Send</button>
        </div>
      </div>
    </div>
  )
}

export default ChatScreen