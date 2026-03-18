import React, { useState } from 'react'

// Returns 'YYYY-MM-DD' for a given year, month (0-indexed), day
function toDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export default function CalendarPanel({ days = [], selectedDate, onSelect }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const activeDates = new Set(days.map(d => d.date))

  const firstDay = new Date(year, month, 1)
  // Week starts Monday: shift Sunday (0) to 6, others -1
  const startOffset = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const monthLabel = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' })
  const DAY_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className="w-44 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
      {/* Month nav */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <button
          onClick={prevMonth}
          className="text-gray-500 hover:text-gray-300 text-xs px-1 cursor-pointer"
        >
          ◀
        </button>
        <span className="text-xs text-gray-300 font-medium">{monthLabel}</span>
        <button
          onClick={nextMonth}
          className="text-gray-500 hover:text-gray-300 text-xs px-1 cursor-pointer"
        >
          ▶
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 px-2 pt-2">
        {DAY_HEADERS.map((h, i) => (
          <div key={i} className="text-center text-gray-600 text-[10px] pb-1">{h}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 px-2 gap-y-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />
          const dateStr = toDateStr(year, month, day)
          const hasData = activeDates.has(dateStr)
          const isSelected = dateStr === selectedDate
          return (
            <div
              key={dateStr}
              onClick={() => hasData && onSelect(dateStr)}
              className={`
                flex flex-col items-center justify-center py-0.5 rounded text-[11px] leading-none
                ${hasData ? 'cursor-pointer' : 'cursor-default'}
                ${isSelected
                  ? 'bg-blue-600 text-white'
                  : hasData
                    ? 'text-gray-200 hover:bg-gray-700'
                    : 'text-gray-600'}
              `}
            >
              {day}
              {hasData && !isSelected && (
                <span className="w-1 h-1 rounded-full bg-blue-400 mt-0.5" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
