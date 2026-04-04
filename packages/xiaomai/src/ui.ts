// 聊天界面 UI

import { UserSession } from './index.js'

export function getChatHTML(session: UserSession): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>小麦 - 聊天</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0a;
            color: #ffffff;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        /* 顶部工具栏 */
        .header {
            background: #1f2937;
            border-bottom: 1px solid #374151;
            padding: 1rem 1.5rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
        }
        
        .header-left {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        .xiaomai-avatar {
            font-size: 2rem;
        }
        
        .xiaomai-name {
            font-size: 1.2rem;
            font-weight: 600;
            background: linear-gradient(135deg, #fbbf24, #f59e0b);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .header-right {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        
        .user-info {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .user-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: 2px solid #374151;
        }
        
        .user-name {
            color: #d1d5db;
            font-size: 0.9rem;
        }
        
        .logout-btn {
            background: #dc2626;
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            font-size: 0.9rem;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .logout-btn:hover {
            background: #b91c1c;
        }
        
        /* 聊天区域 */
        .chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            max-width: 800px;
            margin: 0 auto;
            width: 100%;
        }
        
        .messages-area {
            flex: 1;
            overflow-y: auto;
            padding: 2rem 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
            min-height: 0;
        }
        
        .message {
            display: flex;
            gap: 0.75rem;
            max-width: 85%;
        }
        
        .message.user {
            align-self: flex-end;
            flex-direction: row-reverse;
        }
        
        .message-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            border: 2px solid #374151;
        }
        
        .message.user .message-avatar {
            background: url('${session.picture}');
            background-size: cover;
            background-position: center;
        }
        
        .message.assistant .message-avatar {
            background: #374151;
        }
        
        .message-content {
            background: #1f2937;
            border-radius: 18px;
            padding: 1rem 1.25rem;
            border: 1px solid #374151;
            line-height: 1.6;
            word-wrap: break-word;
        }
        
        .message.user .message-content {
            background: #1e40af;
            color: white;
        }
        
        .message-time {
            font-size: 0.75rem;
            color: #6b7280;
            margin-top: 0.25rem;
        }
        
        /* 输入区域 */
        .input-area {
            background: #1f2937;
            border-top: 1px solid #374151;
            padding: 1rem 1.5rem;
            flex-shrink: 0;
        }
        
        .input-form {
            display: flex;
            gap: 0.75rem;
            max-width: 800px;
            margin: 0 auto;
        }
        
        .message-input {
            flex: 1;
            background: #374151;
            border: 1px solid #4b5563;
            border-radius: 25px;
            padding: 0.75rem 1.25rem;
            color: white;
            font-size: 1rem;
            outline: none;
            transition: border-color 0.2s;
        }
        
        .message-input:focus {
            border-color: #fbbf24;
        }
        
        .message-input::placeholder {
            color: #9ca3af;
        }
        
        .send-btn {
            background: #fbbf24;
            color: #0a0a0a;
            border: none;
            border-radius: 50%;
            width: 48px;
            height: 48px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            font-size: 1.2rem;
        }
        
        .send-btn:hover {
            background: #f59e0b;
            transform: scale(1.05);
        }
        
        .send-btn:disabled {
            background: #6b7280;
            cursor: not-allowed;
            transform: none;
        }
        
        /* 加载状态 */
        .loading {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            color: #9ca3af;
        }
        
        .loading-dots {
            display: flex;
            gap: 0.25rem;
        }
        
        .loading-dot {
            width: 6px;
            height: 6px;
            background: #9ca3af;
            border-radius: 50%;
            animation: bounce 1.4s infinite ease-in-out both;
        }
        
        .loading-dot:nth-child(1) { animation-delay: -0.32s; }
        .loading-dot:nth-child(2) { animation-delay: -0.16s; }
        
        @keyframes bounce {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1); }
        }
        
        /* 欢迎消息 */
        .welcome-message {
            background: linear-gradient(135deg, #1f2937, #374151);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1rem;
            border: 1px solid #fbbf24;
            text-align: center;
        }
        
        .welcome-title {
            font-size: 1.2rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: #fbbf24;
        }
        
        .welcome-text {
            color: #d1d5db;
            line-height: 1.6;
        }
        
        /* 工具按钮 */
        .tools {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 1rem;
        }
        
        .tool-btn {
            background: #374151;
            color: #d1d5db;
            border: 1px solid #4b5563;
            border-radius: 8px;
            padding: 0.5rem 1rem;
            font-size: 0.9rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .tool-btn:hover {
            background: #4b5563;
            border-color: #fbbf24;
        }
        
        /* 响应式设计 */
        @media (max-width: 768px) {
            .header {
                padding: 1rem;
            }
            
            .messages-area {
                padding: 1rem;
            }
            
            .input-area {
                padding: 1rem;
            }
            
            .message {
                max-width: 95%;
            }
            
            .user-name {
                display: none;
            }
        }
    </style>
</head>
<body>
    <!-- 头部工具栏 -->
    <div class="header">
        <div class="header-left">
            <div class="xiaomai-avatar">🌾</div>
            <div class="xiaomai-name">小麦</div>
        </div>
        <div class="header-right">
            <div class="user-info">
                <img src="${session.picture}" alt="${session.name}" class="user-avatar">
                <span class="user-name">${session.name}</span>
            </div>
            <button class="logout-btn" onclick="logout()">登出</button>
        </div>
    </div>
    
    <!-- 聊天容器 -->
    <div class="chat-container">
        <div class="messages-area" id="messages">
            <!-- 欢迎消息 -->
            <div class="welcome-message">
                <div class="welcome-title">你好，${session.name}！👋</div>
                <div class="welcome-text">
                    我是小麦 🌾，很高兴认识你！我可以帮你查信息、做计算、写文案、翻译，或者单纯聊天。<br>
                    <br>
                    <strong>隐私提醒：</strong>我的记忆在所有用户间共享，请避免分享敏感个人信息哦～
                </div>
            </div>
            
            <!-- 快捷工具 -->
            <div class="tools">
                <button class="tool-btn" onclick="sendQuickMessage('介绍一下你自己')">自我介绍</button>
                <button class="tool-btn" onclick="sendQuickMessage('今天天气怎么样？')">今日天气</button>
                <button class="tool-btn" onclick="sendQuickMessage('给我讲个有趣的故事')">讲故事</button>
                <button class="tool-btn" onclick="clearHistory()">清空历史</button>
            </div>
        </div>
        
        <!-- 输入区域 -->
        <div class="input-area">
            <form class="input-form" onsubmit="sendMessage(event)">
                <input 
                    type="text" 
                    class="message-input" 
                    id="messageInput"
                    placeholder="输入消息..." 
                    maxlength="2000"
                    autocomplete="off"
                />
                <button type="submit" class="send-btn" id="sendBtn">
                    ➤
                </button>
            </form>
        </div>
    </div>
    
    <script>
        let isLoading = false
        const messagesArea = document.getElementById('messages')
        const messageInput = document.getElementById('messageInput')
        const sendBtn = document.getElementById('sendBtn')
        
        // 页面加载时获取历史消息
        window.addEventListener('load', loadHistory)
        
        // 发送消息
        async function sendMessage(event) {
            event.preventDefault()
            
            if (isLoading) return
            
            const message = messageInput.value.trim()
            if (!message) return
            
            // 清空输入框
            messageInput.value = ''
            
            // 添加用户消息到界面
            addMessage('user', message, new Date())
            
            // 设置加载状态
            setLoading(true)
            
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ message }),
                })
                
                if (!response.ok) {
                    throw new Error('网络请求失败')
                }
                
                const data = await response.json()
                
                // 添加助手回复到界面
                addMessage('assistant', data.response, new Date(data.timestamp))
                
            } catch (error) {
                console.error('发送消息失败:', error)
                addMessage('assistant', '抱歉，我遇到了一些技术问题。请稍后重试。', new Date())
            } finally {
                setLoading(false)
            }
        }
        
        // 快捷发送消息
        function sendQuickMessage(message) {
            messageInput.value = message
            sendMessage({ preventDefault: () => {} })
        }
        
        // 添加消息到界面
        function addMessage(role, content, timestamp) {
            const messageDiv = document.createElement('div')
            messageDiv.className = \`message \${role}\`
            
            const time = timestamp.toLocaleTimeString('zh-CN', { 
                hour: '2-digit', 
                minute: '2-digit' 
            })
            
            if (role === 'user') {
                messageDiv.innerHTML = \`
                    <div class="message-avatar" style="background-image: url('${session.picture}')"></div>
                    <div>
                        <div class="message-content">\${escapeHtml(content)}</div>
                        <div class="message-time">\${time}</div>
                    </div>
                \`
            } else {
                messageDiv.innerHTML = \`
                    <div class="message-avatar">🌾</div>
                    <div>
                        <div class="message-content">\${renderMarkdown(content)}</div>
                        <div class="message-time">\${time}</div>
                    </div>
                \`
            }
            
            messagesArea.appendChild(messageDiv)
            messagesArea.scrollTop = messagesArea.scrollHeight
        }
        
        // 设置加载状态
        function setLoading(loading) {
            isLoading = loading
            sendBtn.disabled = loading
            messageInput.disabled = loading
            
            if (loading) {
                const loadingDiv = document.createElement('div')
                loadingDiv.className = 'message assistant'
                loadingDiv.id = 'loading-message'
                loadingDiv.innerHTML = \`
                    <div class="message-avatar">🌾</div>
                    <div class="message-content loading">
                        小麦正在思考
                        <div class="loading-dots">
                            <div class="loading-dot"></div>
                            <div class="loading-dot"></div>
                            <div class="loading-dot"></div>
                        </div>
                    </div>
                \`
                messagesArea.appendChild(loadingDiv)
                messagesArea.scrollTop = messagesArea.scrollHeight
            } else {
                const loadingMessage = document.getElementById('loading-message')
                if (loadingMessage) {
                    loadingMessage.remove()
                }
            }
        }
        
        // 加载历史消息
        async function loadHistory() {
            try {
                const response = await fetch('/api/history')
                if (!response.ok) return
                
                const data = await response.json()
                const history = data.history || []
                
                // 清除欢迎消息之后的内容（保留欢迎消息和工具栏）
                const existingMessages = messagesArea.querySelectorAll('.message')
                existingMessages.forEach(msg => msg.remove())
                
                // 添加历史消息
                history.forEach(msg => {
                    addMessage(msg.role, msg.content, new Date(msg.timestamp || Date.now()))
                })
                
            } catch (error) {
                console.error('加载历史失败:', error)
            }
        }
        
        // 清空历史记录
        async function clearHistory() {
            if (!confirm('确定要清空所有聊天记录吗？')) return
            
            try {
                const response = await fetch('/api/clear', { method: 'POST' })
                if (response.ok) {
                    // 清除界面中的消息（保留欢迎消息和工具栏）
                    const messages = messagesArea.querySelectorAll('.message')
                    messages.forEach(msg => msg.remove())
                }
            } catch (error) {
                console.error('清空历史失败:', error)
                alert('清空失败，请重试')
            }
        }
        
        // 登出
        async function logout() {
            if (!confirm('确定要登出吗？')) return
            
            try {
                const response = await fetch('/auth/logout', { method: 'POST' })
                if (response.ok) {
                    window.location.reload()
                }
            } catch (error) {
                console.error('登出失败:', error)
            }
        }
        
        // HTML 转义
        function escapeHtml(text) {
            const div = document.createElement('div')
            div.textContent = text
            return div.innerHTML
        }
        
        // 简单的 Markdown 渲染（正则表达式）
        function renderMarkdown(text) {
            return escapeHtml(text)
                .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
                .replace(/\\*(.*?)\\*/g, '<em>$1</em>')
                .replace(/\`(.*?)\`/g, '<code style="background: #374151; padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace;">$1</code>')
                .replace(/\\n/g, '<br>')
        }
        
        // Enter 键发送消息
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage(e)
            }
        })
        
        // 自动聚焦输入框
        messageInput.focus()
    </script>
</body>
</html>`
}