import { useState, useEffect } from 'react'
import ChatScreen from './ChatScreen'
import PracticeScreen from './PracticeScreen'
import DashboardScreen from './DashboardScreen'
import ConceptInsightsScreen from './ConceptInsightsScreen'
import LoginModal from './LoginModal'
import './App.css'

const navItems = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'chat', label: 'Chat', icon: 'chat_bubble' },
  { id: 'practice', label: 'Quizzes', icon: 'quiz' },
  { id: 'dashboard', label: 'Progress', icon: 'leaderboard' },
  { id: 'insights', label: 'Insights', icon: 'insights' },
]

function App() {
  const [activeTab, setActiveTab] = useState('home')
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('tutor-user')
    return saved ? JSON.parse(saved) : null
  })
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [pendingChatQuestion, setPendingChatQuestion] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('tutor-theme') || 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('tutor-theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'))
  }

  function handleLogin(userData) {
    setUser(userData)
    localStorage.setItem('tutor-user', JSON.stringify(userData))
    setShowLoginModal(false)
  }

  function handleSignOut() {
    setUser(null)
    setShowProfileMenu(false)
    localStorage.removeItem('tutor-user')
    setActiveTab('home')
  }

  function handleAskPrerequisite(topic) {
    setPendingChatQuestion(`Can you explain ${topic}?`)
    setActiveTab('chat')
  }

  return (
    <div className="bg-surface-soft text-on-surface h-screen flex flex-col overflow-hidden">

      <header className="bg-surface-container-lowest/90 backdrop-blur-md border-b border-outline-variant shadow-[0px_4px_12px_rgba(79,70,229,0.04)] sticky top-0 z-50 shrink-0">
        <div className="flex items-center justify-between gap-sm w-full max-w-[1280px] mx-auto px-margin-mobile md:px-margin-desktop py-sm">
          <div className="flex items-center gap-sm">
            <div className="w-9 h-9 rounded-xl overflow-hidden bg-surface-container flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-primary text-xl">smart_toy</span>
            </div>
            <div className="hidden sm:block leading-tight">
              <h2 className="text-title-md font-title-md font-bold text-primary m-0">Concepta</h2>
              <p className="text-label-md font-label-md text-on-surface-variant font-normal m-0">Your Learning Co-pilot</p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1 bg-surface-container/60 rounded-xl p-1">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={activeTab === item.id
                  ? 'flex items-center gap-2 px-3 py-2 bg-surface-container-lowest text-primary rounded-lg font-bold text-label-md shadow-sm transition-all'
                  : 'flex items-center gap-2 px-3 py-2 text-on-surface-variant hover:text-primary rounded-lg text-label-md transition-colors'}
              >
                <span className="material-symbols-outlined text-lg">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('practice')}
              className="hidden lg:inline-flex bg-primary text-on-primary text-label-md font-label-md rounded-xl py-2 px-4 mr-1 hover:bg-primary-container transition-all hover:-translate-y-0.5 shadow-sm"
            >
              Start Review
            </button>
            <button className="theme-toggle-btn p-2 text-on-surface-variant hover:bg-surface-container rounded-full transition-all" onClick={toggleTheme}>
              <span className="material-symbols-outlined">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <button className="p-2 text-on-surface-variant hover:bg-surface-container rounded-full transition-all">
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <button className="hidden sm:inline-flex p-2 text-on-surface-variant hover:bg-surface-container rounded-full transition-all">
              <span className="material-symbols-outlined">settings</span>
            </button>

            {user ? (
              <div className="profile-menu-wrapper">
                <button className="profile-avatar-btn" onClick={() => setShowProfileMenu(prev => !prev)}>
                  {user.picture ? <img src={user.picture} alt={user.name} /> : <span className="avatar-initial">{user.name.charAt(0).toUpperCase()}</span>}
                </button>
                {showProfileMenu && (
                  <div className="profile-dropdown">
                    <div className="profile-dropdown-header">
                      <div className="profile-dropdown-name">{user.name}</div>
                      <div className="profile-dropdown-email">{user.email}</div>
                    </div>
                    <button className="profile-dropdown-signout" onClick={handleSignOut}>Sign out</button>
                  </div>
                )}
              </div>
            ) : (
              <button className="signin-header-btn" onClick={() => setShowLoginModal(true)}>Sign In</button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-margin-mobile md:p-margin-desktop w-full max-w-[1280px] mx-auto pb-24 md:pb-margin-desktop">
        {activeTab === 'home' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter">
            <div className="col-span-1 md:col-span-12 bg-surface-container-lowest rounded-2xl p-md md:p-lg shadow-[0px_4px_12px_rgba(79,70,229,0.04)] border border-surface-container flex flex-col md:flex-row items-center justify-between gap-md relative overflow-hidden">
              <div className="absolute right-0 top-0 w-1/3 h-full opacity-10 bg-gradient-to-l from-primary to-transparent pointer-events-none"></div>
              <div className="relative z-10 w-full md:w-2/3">
                <h2 className="text-headline-lg font-headline-lg text-on-surface mb-2">
                  {user ? `Ready to learn, ${user.name.split(' ')[0]}?` : 'Ready to learn?'}
                </h2>
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

        {activeTab === 'chat' && <ChatScreen pendingQuestion={pendingChatQuestion} onConsumePending={() => setPendingChatQuestion(null)} />}
        {activeTab === 'practice' && <PracticeScreen onAskPrerequisite={handleAskPrerequisite} />}
        {activeTab === 'dashboard' && <DashboardScreen />}
        {activeTab === 'insights' && <ConceptInsightsScreen />}
      </main>

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

      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} onLogin={handleLogin} />}
    </div>
  )
}

export default App