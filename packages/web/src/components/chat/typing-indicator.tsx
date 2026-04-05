import { motion } from 'motion/react'

export function TypingIndicator() {
  return (
    <motion.div
      className="flex gap-2.5 self-start max-w-[85%]"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xl bg-white/[0.05] border border-white/[0.06]">
        🔓
      </div>
      <div className="bg-white/[0.04] backdrop-blur-sm border border-white/[0.06] rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex items-center gap-2">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="w-2 h-2 bg-text-3 rounded-full"
              animate={{
                opacity: [0.3, 1, 0.3],
                scale: [0.85, 1.1, 0.85],
              }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: i * 0.2,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  )
}
