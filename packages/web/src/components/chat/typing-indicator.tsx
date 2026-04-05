export function TypingIndicator() {
  return (
    <div className="flex gap-2 self-start max-w-[85%]">
      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xl bg-surface-2">
        🔓
      </div>
      <div className="bg-surface-2 border border-border rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 bg-text-3 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
