import { useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { AuthGuard } from '../components/layout/auth-guard'
import { Header } from '../components/layout/header'
import { MessageList } from '../components/chat/message-list'
import { ChatInput } from '../components/chat/chat-input'
import { useChat } from '../hooks/use-chat'

export function ChatPage() {
  const { owner, agent } = useParams<{ owner: string; agent: string }>()
  const basePath = `/${owner}/${agent}`
  const ownerPath = `/${owner}`

  return (
    <AuthGuard>
      {({ user, logout }) => (
        <ChatPageInner
          agentName={agent || ''}
          basePath={basePath}
          ownerPath={ownerPath}
          user={user}
          logout={logout}
        />
      )}
    </AuthGuard>
  )
}

function ChatPageInner({
  agentName,
  basePath,
  ownerPath,
  user,
  logout,
}: {
  agentName: string
  basePath: string
  ownerPath: string
  user: { id: string; displayName: string; slug: string | null; createdAt: number }
  logout: () => Promise<void>
}) {
  const { messages, loading, sending, sendMessage, addToolResult } = useChat(basePath)

  return (
    <motion.div
      className="h-screen flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <Header agentName={agentName} user={user} onLogout={logout} />
      <MessageList messages={messages} loading={loading} sending={sending} />
      <ChatInput
        onSend={sendMessage}
        disabled={sending}
        ownerPath={ownerPath}
        basePath={basePath}
        addToolResult={addToolResult}
      />
    </motion.div>
  )
}
