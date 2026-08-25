import './App.css'

function CircularGauge({ percentage, size = 170, strokeWidth = 14, sublabel }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, percentage))
  const offset = circumference - (clamped / 100) * circumference

  return (
    <div className="circular-gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--primary-light)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke="var(--primary)" strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="circular-gauge-arc"
        />
      </svg>
      <div className="circular-gauge-center">
        <span className="circular-gauge-value">{clamped}<span className="circular-gauge-percent-sign">%</span></span>
        {sublabel && <span className="circular-gauge-sublabel">{sublabel}</span>}
      </div>
    </div>
  )
}

export default CircularGauge