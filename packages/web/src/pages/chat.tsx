import { useParams } from 'react-router-dom'
import { AuthGuard } from '../components/layout/auth-guard'
import { Header } from '../components/layout/header'
import { MessageList } from '../components/chat/message-list'
import { ChatInput } from '../components/chat/chat-input'
import { useChat } from '../hooks/use-chat'

export function ChatPage() {
  const { owner, agent } = useParams<{ owner: string; agent: string }>()
  const basePath = `/${owner}/${agent}`

  return (
    <AuthGuard>
      {({ user, logout }) => (
        <ChatPageInner
          agentName={agent || ''}
          basePath={basePath}
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
  user,
  logout,
}: {
  agentName: string
  basePath: string
  user: { id: string; displayName: string; slug: string | null; createdAt: number }
  logout: () => Promise<void>
}) {
  const { messages, loading, sending, sendMessage } = useChat(basePath)

  return (
    <div className="h-screen flex flex-col">
      <Header agentName={agentName} user={user} onLogout={logout} />
      <MessageList messages={messages} loading={loading} sending={sending} />
      <ChatInput onSend={sendMessage} disabled={sending} />
    </div>
  )
}
