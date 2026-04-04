# 多模态图片处理验证 v2 - DashScope Files API

## 新实现方案

使用 DashScope Files API 上传图片，获得 `file://` 引用来传递给 VL 模型。

### 关键更改

1. **新增 `uploadImageToDashScope()` 函数** (utils.ts)
   - 上传图片到 DashScope Files API
   - 返回 `file://file-xxx` 格式的引用
   - 失败时自动回退到 base64 data URI

2. **Telegram 图片处理** (telegram.ts)
   - 下载 Telegram 图片到内存
   - 调用 `uploadImageToDashScope()` 
   - 用 file:// 引用或 base64 fallback

3. **API 图片处理** (index.ts /chat)
   - 对外部 URL，下载后上传到 DashScope
   - 保持对 data: 和 file:// 的兼容

### 测试步骤

#### 1. Telegram 测试
```bash
# 通过 Telegram 发送图片 + 文字询问
# 检查日志中的 "[DashScope]" 输出
# 验证返回的分析结果
```

#### 2. API 测试
```bash
# 准备测试图片
curl -X POST https://doudou.shazhou.work/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "这张图片里有什么？",
    "image_url": "https://example.com/test.jpg",
    "chat_id": "test-multimodal"
  }'
```

#### 3. 日志验证
应该看到：
```
[DashScope] Uploading tg-abc12345.jpg (123456 bytes, image/jpeg)
[DashScope] Successfully uploaded: file://file-fe-bd6b101dcc3340a5bceb7587
[Multimodal] Telegram/API: Added multimodal message
```

如果上传失败：
```
[DashScope] Upload failed, falling back to base64: Error...
[DashScope] Fallback to base64 data URI (123456 bytes)
```

### 预期结果

1. **成功情况**：VL 模型收到 `file://` 引用，能正常处理图片
2. **失败情况**：自动回退到 base64 data URI，保持兼容
3. **性能提升**：避免大图片的 base64 编码传输

### 如果 file:// 不兼容 OpenAI format

可以考虑：
1. 使用 DashScope 原生 API 端点
2. 实现 OSS 临时存储
3. 优化 base64 data URI 处理

---

修改时间：2026-04-04 10:03 UTC
修改人：小橘 🍊（NEKO Team）