# Knowledge Injection Test Plan

## 已实现的功能

### 1. 改造了 `knowledgeInjector` ✅
- 接受 Memory 实例和 chatId 参数
- 从 D1 预取当前联系人的知识
- 多搜索词策略：chatId + 从消息中提取的显示名
- 注入联系人特定知识和通用事实到 system prompt
- 优雅降级：D1 不可用时跳过注入

### 2. 添加了 `hasD1Access()` 方法 ✅
- 在 Memory 类中添加 public 方法
- 返回 this.hasD1 状态

### 3. 修改了 agentLoop 签名 ✅  
- 新增 chatId?: string 参数
- 在 pipeline 中调用 knowledgeInjector(memory, chatId || 'unknown')
- knowledgeInjector 位于 contextCompressor 之前，避免注入的知识被压缩

### 4. 传入 chatId ✅
- telegram.ts: 传入 memorySessionId (如 "telegram:Scott")  
- index.ts: 传入 body.chat_id (如 "xiaoju")

## 测试方案

### 前提条件
1. D1 knowledge 表中有数据
2. 已部署到 Cloudflare Workers

### 测试步骤
1. 清除某个 chat 的历史记录 (`/clear`)
2. 发送 "你知道我是谁吗?" 
3. 观察是否不需要 tool call 就能回答
4. 检查 console 输出是否有 "[Pipeline] Injected X knowledge entries"

### 预期结果
- LLM 应该在没有 recall_knowledge tool call 的情况下就知道联系人信息
- Console 显示注入的知识条目数量
- 回答应该包含从 D1 预取的个人资料信息

## 代码变更摘要

1. **pipeline.ts**: 实现了完整的 knowledgeInjector 逻辑
2. **memory.ts**: 添加了 hasD1Access() public 方法  
3. **llm.ts**: 修改 agentLoop 签名，导入并使用 knowledgeInjector
4. **telegram.ts**: 传入 memorySessionId 作为 chatId
5. **index.ts**: 传入 body.chat_id 作为 chatId

## 架构改进

- **知识预热**: 在 pipeline 阶段就从 D1 预取知识，减少运行时 tool call
- **智能搜索**: 使用多个搜索词（chatId + 提取的显示名）提高匹配率
- **性能优化**: knowledgeInjector 在 contextCompressor 前运行，确保注入的知识不被压缩
- **优雅降级**: D1 不可用时不影响正常对话流程

commit: 556b387 - "feat: knowledge pre-heat adapter — inject contact profile into system prompt"