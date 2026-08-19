import { useState } from 'react'
import './App.css'

const practiceQuestions = [
  { topic: 'Recursion', question: 'What happens if a recursive function has no base case?', options: ['It runs once and stops', 'It runs forever until the program crashes', 'It automatically returns 0', 'It skips to the next function'], correctIndex: 1, explanation: 'Without a base case, the function keeps calling itself with no stopping point, eventually causing a stack overflow.' },
  { topic: 'Linked List', question: 'What does each node in a linked list contain?', options: ['Only data', 'Only a pointer to the next node', 'Data and a pointer to the next node', 'A fixed array index'], correctIndex: 2, explanation: 'Each node stores its own data plus a reference (pointer) to the next node in the sequence.' },
  { topic: 'Binary Search', question: 'What is required for binary search to work correctly?', options: ['The list must be sorted', 'The list must be unsorted', 'The list must contain only numbers', 'The list must have an even number of elements'], correctIndex: 0, explanation: 'Binary search relies on repeatedly halving a sorted list — it does not work correctly on unsorted data.' }
]

function logAttempt(topic, correct) {
  const existing = JSON.parse(localStorage.getItem('student-progress-log') || '[]')
  existing.push({ topic, correct, timestamp: Date.now() })
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
    logAttempt(current.topic, isCorrect)
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