import { useState, useEffect } from 'react'
import './App.css'

const fakeKnowledgeBase = [
  { keyword: 'recursion', answer: 'Recursion is when a function calls itself to solve smaller instances of the same problem.', source: 'Page 12, Unit 3 — Recursion' },
  { keyword: 'linked list', answer: 'A linked list is a data structure where each element (node) points to the next one, instead of sitting in one continuous block like an array.', source: 'Page 5, Unit 2 — Data Structures' },
  { keyword: 'binary search', answer: 'Binary search finds an item in a sorted list by repeatedly checking the middle element and eliminating half the list each time.', source: 'Page 20, Unit 4 — Searching Algorithms' }
]

function createEmptySession() {
  return {
    id: Date.now(),
    title: 'New chat',
    messages: [
      { sender: 'bot', type: 'normal', text: 'Hi! Try asking me about recursion, linked lists, or binary search — or ask something unrelated to see what happens.' }
    ]
  }
}

function ChatScreen() {
  const [sessions, setSessions] = useState(() => {
    const saved = localStorage.getItem('tutor-chat-sessions')
    return saved ? JSON.parse(saved) : [createEmptySession()]
  })
  const [activeId, setActiveId] = useState(() => sessions[0].id)
  const [input, setInput] = useState('')

  useEffect(() => {
    localStorage.setItem('tutor-chat-sessions', JSON.stringify(sessions))
  }, [sessions])

  const activeSession = sessions.find(s => s.id === activeId) || sessions[0]

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
      const botMsg = match
        ? { sender: 'bot', type: 'citation', text: match.answer, source: match.source }
        : { sender: 'bot', type: 'refusal', text: "I don't have enough information in the course material to answer that confidently." }

      setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, messages: [...s.messages, botMsg] } : s))
    }, 600)
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
          {activeSession.messages.map((msg, index) => (
            <div key={index} className={`message ${msg.sender} ${msg.type}`}>
              <div>{msg.text}</div>
              {msg.type === 'citation' && <div className="citation-source">📄 Source: {msg.source}</div>}
            </div>
          ))}
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