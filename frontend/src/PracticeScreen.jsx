import { useState } from 'react'
import './App.css'

const practiceQuestions = [
  { topic: 'Linear Equations', question: 'What is the general form of a linear equation in two variables?', options: ['Ax + By + C = 0', 'Ax^2 + B = 0', 'A/x + B/y = 0', 'Ax + B = C^2'], correctIndex: 0, explanation: 'A linear equation in two variables is written as Ax + By + C = 0, where A and B are not both zero — it represents a straight line.' },
  { topic: 'Binomial Theorem', question: 'What does the Binomial Theorem help you do?', options: ['Solve quadratic equations', 'Expand expressions like (a+b)^n', 'Find derivatives', 'Calculate probability'], correctIndex: 1, explanation: 'The Binomial Theorem provides a formula for expanding powers of a binomial like (a+b)^n without multiplying it out term by term.' },
  { topic: 'Probability', question: 'What is the probability of a certain (sure) event?', options: ['0', '0.5', '1', 'Cannot be determined'], correctIndex: 2, explanation: 'A certain event is guaranteed to happen, so its probability is always 1 — the maximum value probability can take.' }
]

function logAttempt(topic, correct, question) {
  const existing = JSON.parse(localStorage.getItem('student-progress-log') || '[]')
  existing.push({ topic, correct, question, timestamp: Date.now() })
  localStorage.setItem('student-progress-log', JSON.stringify(existing))
}

function PracticeScreen() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedOption, setSelectedOption] = useState(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const [weakTopics, setWeakTopics] = useState([])
  const [finished, setFinished] = useState(false)

  const current = practiceQuestions[currentIndex]

  function handleSelect(index) {
    if (showFeedback) return
    setSelectedOption(index)
    setShowFeedback(true)
    const isCorrect = index === current.correctIndex
    logAttempt(current.topic, isCorrect, current.question)
    if (!isCorrect) {
      setWeakTopics(prev => [...prev, current.topic])
    }
  }

  function handleNext() {
    if (currentIndex + 1 < practiceQuestions.length) {
      setCurrentIndex(currentIndex + 1)
      setSelectedOption(null)
      setShowFeedback(false)
    } else {
      setFinished(true)
    }
  }

  function handleRestart() {
    setCurrentIndex(0)
    setSelectedOption(null)
    setShowFeedback(false)
    setWeakTopics([])
    setFinished(false)
  }

  if (finished) {
    const correctCount = practiceQuestions.length - new Set(weakTopics).size
    return (
      <div className="practice-container">
        <h2>Session complete</h2>
        <p>You got {correctCount} out of {practiceQuestions.length} correct.</p>
        {weakTopics.length > 0 ? (
          <div>
            <p>Topics to review:</p>
            <ul>{[...new Set(weakTopics)].map(topic => <li key={topic}>{topic}</li>)}</ul>
          </div>
        ) : (
          <p>No weak spots detected — great job!</p>
        )}
        <button onClick={handleRestart}>Try again</button>
      </div>
    )
  }

  return (
    <div className="practice-container">
      <div className="practice-progress">Question {currentIndex + 1} of {practiceQuestions.length}</div>
      <h3>{current.question}</h3>
      <div className="options">
        {current.options.map((option, index) => {
          let optionClass = 'option'
          if (showFeedback) {
            if (index === current.correctIndex) optionClass += ' correct'
            else if (index === selectedOption) optionClass += ' wrong'
          }
          return <button key={index} className={optionClass} onClick={() => handleSelect(index)}>{option}</button>
        })}
      </div>
      {showFeedback && (
        <div className="feedback">
          <p>{selectedOption === current.correctIndex ? '✅ Correct!' : '❌ Not quite.'}</p>
          <p>{current.explanation}</p>
          <button onClick={handleNext}>{currentIndex + 1 < practiceQuestions.length ? 'Next question' : 'See results'}</button>
        </div>
      )}
    </div>
  )
}

export default PracticeScreen