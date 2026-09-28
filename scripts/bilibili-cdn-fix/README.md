# B站坏 CDN 节点绕过

**[点击安装](https://raw.githubusercontent.com/zidou-kiyn/tampermonkey-scripts/main/scripts/bilibili-cdn-fix/bilibili-cdn-fix.user.js)**（需要先装 Tampermonkey / ScriptCat / Violentmonkey）

## 解决什么问题

在某些宽带（实测：河南郑州电信）下，鼠标悬浮在 B 站视频上要等很久才出预览，打开视频也起播很慢；换成移动网络就正常。

## 原因

B 站返回的播放地址（`/x/player/wbi/playurl`）里，主地址被调度到了 `cn-hnzz-fx-01-*.bilivideo.com` 这类节点：

- IP 为 `183.170.158.x`，归属查询为“河南师范大学新联学院”，从电信出去要绕教育网（`210.43.x`）；
- 能 ping 通，但 HTTP/HTTPS 基本拿不到响应，要等到超时；
- 播放器等主地址超时后，才会去试接口里自带的 `backupUrl`（upos 镜像），于是表现为“等很久才开始播”。

直接把坏节点的域名改成 upos 镜像不行：这类地址（`os=bcache`）的签名和节点绑定，改域名会返回 781。

## 原理

脚本拦截 playurl 接口的响应（fetch 和 XHR 都拦，视频页首屏内嵌的 `window.__playinfo__` 也处理）：

1. 主地址的域名匹配 `BAD_HOST`（默认 `^cn-[a-z0-9]+-fx-`）时，视为坏节点；
2. 从同一条目的 `backupUrl` 里挑一个非坏节点换上，优先 `mirrorcos` → `mirrorali` → `mirrorhw`；
3. 主地址不是坏节点，或没有备用地址时，不做任何修改。

只按域名判断，不测速。换到其他网络（例如移动，一般分到 `cm` 节点）时脚本不会生效，不影响正常使用。

## 配置

编辑脚本开头：

```js
// 默认只处理 fx 节点。PCDN 也慢的话可以改成：
// /^cn-[a-z0-9]+-fx-|\.mcdn\.bilivideo\.(cn|com)$|\.szbdyd\.com$/i
const BAD_HOST = /^cn-[a-z0-9]+-fx-/i;
```

## 确认生效

F12 控制台里能看到：

```
[bili-cdn-fix] 已启用
[bili-cdn-fix] 替换了 N 个坏节点地址
```

## 局限

- 按域名规则判断，有可能误伤一个其实能用的 fx 节点（只是换到 upos，不会导致放不出来）；
- 其他名字的坏节点识别不了，需要调整 `BAD_HOST`；
- 接口没给备用地址时无法替换；
- 只对网页生效。B 站 App 可以在 Clash / 路由器上加 `DOMAIN-REGEX,^cn-[a-z0-9]+-fx-,REJECT` 让坏节点立即失败（未实测）。

## 更新日志

- **1.0.0**：首个版本。
