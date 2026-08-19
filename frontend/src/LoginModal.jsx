import { useState } from 'react'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.5 29.6 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.5 29.6 4.5 24 4.5c-7.7 0-14.3 4.4-17.7 10.2z"/>
      <path fill="#4CAF50" d="M24 43.5c5.5 0 10.5-1.9 14.3-5.1l-6.6-5.4C29.7 34.6 27 35.5 24 35.5c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.6 39 16.2 43.5 24 43.5z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.6 5.4C41.4 36.5 43.5 30.8 43.5 24c0-1.2-.1-2.4-.4-3.5z"/>
    </svg>
  )
}

function LoginModal({ onClose, onLogin }) {
  const [mode, setMode] = useState('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) return
    onLogin({
      name: mode === 'signup' && name.trim() ? name.trim() : email.split('@')[0],
      email: email.trim(),
      picture: null
    })
  }

  function handleGoogleFake() {
    onLogin({ name: 'Demo Student', email: 'demo.student@gmail.com', picture: null })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <span className="material-symbols-outlined">close</span>
        </button>

        <h2 className="modal-title">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
        <p className="modal-subtitle">{mode === 'signin' ? 'Sign in to save your chats and progress.' : 'Sign up to start tracking your learning.'}</p>

        <button className="google-fake-btn" onClick={handleGoogleFake}>
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="modal-divider"><span>or</span></div>

        <form onSubmit={handleSubmit} className="modal-form">
          {mode === 'signup' && (
            <input type="text" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="submit" className="modal-submit-btn">{mode === 'signin' ? 'Sign In' : 'Create Account'}</button>
        </form>

        <p className="modal-switch">
          {mode === 'signin' ? (
            <>Don't have an account? <button type="button" onClick={() => setMode('signup')}>Sign up</button></>
          ) : (
            <>Already have an account? <button type="button" onClick={() => setMode('signin')}>Sign in</button></>
          )}
        </p>
      </div>
    </div>
  )
}

export default LoginModal