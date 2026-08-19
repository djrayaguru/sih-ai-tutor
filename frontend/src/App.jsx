import { useState } from 'react'
import ChatScreen from './ChatScreen'
import PracticeScreen from './PracticeScreen'
import DashboardScreen from './DashboardScreen'
import './App.css'

const navItems = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'chat', label: 'Chat', icon: 'chat_bubble' },
  { id: 'practice', label: 'Quizzes', icon: 'quiz' },
  { id: 'dashboard', label: 'Progress', icon: 'leaderboard' },
]

const pageTitles = { home: 'Dashboard', chat: 'Chat', practice: 'Quizzes', dashboard: 'Progress' }

function App() {
  const [activeTab, setActiveTab] = useState('home')

  return (
    <div className="bg-surface-soft text-on-surface h-screen flex overflow-hidden">
      <nav className="hidden md:flex flex-col h-full p-md border-r border-outline-variant bg-surface-container-lowest shadow-[0px_4px_12px_rgba(79,70,229,0.04)] w-64 flex-shrink-0 z-50">
        <div className="flex items-center gap-sm mb-lg">
          <div className="w-10 h-10 rounded-xl overflow-hidden bg-surface-container flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-2xl">smart_toy</span>
          </div>
          <div>
            <h2 className="text-title-md font-title-md font-bold text-primary">AI Tutor</h2>
            <p className="text-label-md font-label-md text-on-surface-variant font-normal">Your Learning Co-pilot</p>
          </div>
        </div>

        <div className="flex flex-col gap-xs flex-grow">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={activeTab === item.id
                ? 'flex items-center gap-3 px-4 py-3 bg-indigo-wash text-primary rounded-xl font-bold transition-transform duration-200 text-left'
                : 'flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-indigo-wash hover:text-primary rounded-xl transition-colors duration-200 text-left'}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="text-label-md font-label-md">{item.label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={() => setActiveTab('practice')}
          className="bg-primary text-on-primary text-label-md font-label-md rounded-xl py-3 px-4 mt-auto mb-6 hover:bg-primary-container transition-all hover:-translate-y-0.5 shadow-sm"
        >
          Start Review
        </button>

        <div className="flex flex-col gap-xs pt-4 border-t border-outline-variant">
          <button className="flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-indigo-wash hover:text-primary rounded-xl transition-colors duration-200 text-left">
            <span className="material-symbols-outlined">settings</span>
            <span className="text-label-md font-label-md">Settings</span>
          </button>
          <button className="flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-indigo-wash hover:text-primary rounded-xl transition-colors duration-200 text-left">
            <span className="material-symbols-outlined">help</span>
            <span className="text-label-md font-label-md">Support</span>
          </button>
        </div>
      </nav>

      <div className="flex-1 flex flex-col h-full overflow-hidden relative w-full">
        <header className="bg-surface-soft/80 backdrop-blur-md flex justify-between items-center w-full px-margin-mobile md:px-margin-desktop py-sm md:max-w-[1280px] mx-auto z-40 sticky top-0 shrink-0">
          <div className="md:hidden flex items-center gap-sm">
            <div className="w-8 h-8 rounded-lg overflow-hidden bg-surface-container flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-xl">smart_toy</span>
            </div>
            <h1 className="text-headline-lg-mobile font-headline-lg-mobile font-extrabold tracking-tight text-primary">AI Tutor</h1>
          </div>
          <div className="hidden md:block">
            <h1 className="text-title-md font-title-md text-on-surface font-semibold">{pageTitles[activeTab]}</h1>
          </div>
          <div className="flex items-center gap-sm">
            <button className="p-2 text-on-surface-variant hover:bg-surface-container rounded-full transition-all">
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <button className="p-2 text-on-surface-variant hover:bg-surface-container rounded-full transition-all">
              <span className="material-symbols-outlined">account_circle</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-margin-mobile md:p-margin-desktop w-full max-w-[1280px] mx-auto pb-24 md:pb-margin-desktop">
          {activeTab === 'home' && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter">
              <div className="col-span-1 md:col-span-12 bg-white rounded-2xl p-md md:p-lg shadow-[0px_4px_12px_rgba(79,70,229,0.04)] border border-surface-container flex flex-col md:flex-row items-center justify-between gap-md relative overflow-hidden">
                <div className="absolute right-0 top-0 w-1/3 h-full opacity-10 bg-gradient-to-l from-primary to-transparent pointer-events-none"></div>
                <div className="relative z-10 w-full md:w-2/3">
                  <h2 className="text-headline-lg font-headline-lg text-on-surface mb-2">Ready to learn?</h2>
                  <p className="text-body-lg font-body-lg text-on-surface-variant mb-6">Ask a question, try a quiz, or check your progress below.</p>
                  <button
                    onClick={() => setActiveTab('chat')}
                    className="bg-primary text-on-primary text-label-md font-label-md rounded-xl py-3 px-6 hover:bg-primary-container transition-all hover:-translate-y-0.5 shadow-sm inline-flex items-center gap-2"
                  >
                    Start Session <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </button>
                </div>
                <div className="relative w-full md:w-1/3 h-48 rounded-xl overflow-hidden shadow-sm bg-gradient-to-br from-primary-fixed to-secondary-container flex items-center justify-center">
                  <span className="material-symbols-outlined text-white text-6xl opacity-80">school</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'chat' && <ChatScreen />}
          {activeTab === 'practice' && <PracticeScreen />}
          {activeTab === 'dashboard' && <DashboardScreen />}
        </main>
      </div>

      <div className="md:hidden fixed bottom-0 left-0 w-full bg-surface-container-lowest border-t border-outline-variant flex justify-around items-center py-2 px-4 z-50 shadow-[0px_-4px_12px_rgba(0,0,0,0.05)]">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={activeTab === item.id ? 'flex flex-col items-center gap-1 p-2 text-primary' : 'flex flex-col items-center gap-1 p-2 text-on-surface-variant hover:text-primary transition-colors'}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className="text-caption font-caption">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default App