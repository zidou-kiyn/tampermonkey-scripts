# Bearer 快速复制

**[点击安装](https://raw.githubusercontent.com/zidou-kiyn/tampermonkey-scripts/main/scripts/bearer-copy/bearer-copy.user.js)**（需要先安装 Tampermonkey / ScriptCat / Violentmonkey）

从当前页面的 `fetch` 和 `XMLHttpRequest` 请求头中捕获最近一次出现的 Bearer 令牌，通过油猴菜单手动复制。

## 安装和使用

1. 点击上方安装链接，通过用户脚本管理器安装。脚本包含更新地址；后续发布更高版本后，管理器可按其设置自动检查更新。
2. 打开或刷新目标网页，登录并操作页面，触发使用 Bearer 的接口请求。
3. 点击浏览器工具栏中的 Tampermonkey 图标，选择：
   - **复制最近的 Bearer 令牌**：仅复制令牌，不含 `Bearer ` 前缀。
   - **复制完整 Authorization 值**：复制 `Bearer <令牌>`。
   - **清除已捕获的令牌**：清除当前页面内存中的记录，不清除系统剪贴板。

脚本默认在所有 HTTP/HTTPS 网页运行。建议安装后在 Tampermonkey 的脚本设置中限定到自己需要的站点，或直接修改脚本的 `@match`，例如 `https://example.com/*`。

## 工作原理及限制

- 在页面开始加载时监听页面主框架发出的 fetch/XHR 请求，按请求先后保留最近一个 `Authorization: Bearer ...`。目标 API 可以是跨域地址。页面刷新或关闭后记录消失。
- 不读取 Cookie、本地存储或响应内容，不将令牌写入文件、持久存储、控制台或网络。复制是用户主动操作；系统剪贴板及其历史记录可能被其他应用读取。
- 不能捕获加载脚本前已发送的请求、iframe 或 Web Worker 内的请求，也不能捕获浏览器或扩展在页面之外添加的请求头。如果网站只使用 Cookie，或者不通过上述方式发送 Bearer，脚本不会找到令牌。
- 某些网站的安全策略或脚本隔离可能阻止监听。若菜单提示未捕获，尝试刷新并触发接口请求；仍不行时请在开发者工具的 Network 中检查实际请求头。
- Bearer 是敏感凭据，只在自己有权访问的账号和站点使用，不要分享给他人。复制后可覆盖或清除剪贴板。

## 更新日志

- **0.1.0**：支持从 fetch/XHR 请求捕获 Bearer，并通过菜单复制或清除。
