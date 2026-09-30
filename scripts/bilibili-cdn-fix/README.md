# B站坏 CDN 节点绕过

**[点击安装](https://raw.githubusercontent.com/zidou-kiyn/tampermonkey-scripts/main/scripts/bilibili-cdn-fix/bilibili-cdn-fix.user.js)**（需要先装 Tampermonkey / ScriptCat / Violentmonkey）

## 解决什么问题

鼠标悬浮在 B 站视频上要等很久才出预览、打开视频起播慢，但页面本身、封面图加载都正常。

## 原因

B 站返回的播放地址（`/x/player/wbi/playurl`）里，每个视频/音频流都有一个主地址和若干备用地址。播放器先请求主地址，**超时（约 3 秒）后**才会去试下一个。如果前面的节点在你的网络下不通，每次起播都要白等几秒。

实测遇到过的坏节点：

| 网络 | 被分到的节点 | 表现 |
|---|---|---|
| 河南郑州电信 | `cn-hnzz-fx-01-*.bilivideo.com`（第三方边缘，绕教育网） | 能 ping 通，HTTP 基本超时 |
| 联通 | 主地址 `xy*.mcdn.bilivideo.cn`（PCDN），备用 1 `*.edge.mountaintoys.cn`（第三方边缘） | PCDN 直接失败；mountaintoys 大部分超过 8 秒无响应，播放器每次卡 2.8 秒左右才切到 upos，一个视频要切两次 |

而同一份响应里的 upos 官方源（`upos-sz-*.bilivideo.com`）在两种网络下都是一两百毫秒就能响应。

## 原理

脚本拦截 playurl 接口的响应（fetch 和 XHR 都拦，视频页首屏内嵌的 `window.__playinfo__` 也处理）：

1. 按域名把节点分为四类：
   - **官方 upos**：`upos-*`，B 站源站，始终允许；
   - **B站自建边缘**：`cn-<地区>-<运营商>-*.bilivideo.com`（不含 `fx`）；
   - **PCDN**：`*.mcdn.bilivideo.cn/com`、`*.szbdyd.com`；
   - **第三方边缘**：`cn-*-fx-*`、`*.edge.mountaintoys.cn` 以及其他未知域名。
2. 从主地址和备用地址中去掉不允许的类别，保持原有顺序；
3. 把第一个 upos 地址的域名换成测速最快的镜像，原 upos 地址留在后面兜底。upos 地址的签名不绑定镜像，换域名可以正常播放；`bcache` 类节点（fx 等）的签名绑定节点，不能这样换；
4. 过滤后如果一个可用地址都不剩，就保持原样，保证能播。

### 自动测速

打开视频后，脚本会用这个视频的 upos 地址依次测试各个镜像：先下载 128KB（反映建连和首字节延迟），再下载 512KB（反映带宽），两次耗时相加作为得分，选最快的。测速在起播后 6–10 秒进行，结果保存 6 小时后重测，每次大约消耗 6MB 流量。

联通实测（单位 ms，越小越好）：`mirror08c 202 · mirrorhwo1 264 · mirrorali 312 · mirrorhw 390 · … · mirrorbd 2998`。

## 悬浮面板

页面右侧有一个半透明的 `CDN` 小按钮（可上下拖动），点击打开设置：

- **启用脚本**：总开关；
- **允许使用的节点**：B站自建边缘、PCDN、第三方边缘分别开关（官方 upos 始终允许）；
  - 「只用官方源（推荐）」：只保留 upos 和 B站自建边缘，upos 自动测速；
  - 「B站默认（不干预）」：全部允许，不改镜像，相当于没装脚本；
- **upos 镜像**：自动测速选最快 / 不改（用接口分配的）/ 手动指定某个镜像；
- **立即测速**：换了网络（比如切到手机热点）之后可以手动重测；
- **本页**：当前视频实际使用的节点、B 站原本的主地址类型。

按钮上显示绿点，表示当前视频走的是官方 upos 源。

设置保存在 `.bilibili.com` 的 cookie（`bcf_cfg`、`bcf_speed`）中，各子站共享。改动对之后加载的视频生效，当前视频需要刷新页面。

## 确认生效

F12 控制台里能看到：

```
[bili-cdn-fix] 已启用 {...}
[bili-cdn-fix] 改写了 N 个流地址，视频源：upos-sz-mirror08c.bilivideo.com
[bili-cdn-fix] 测速完成，最快镜像：upos-sz-mirror08c.bilivideo.com（202ms）
```

如果连「已启用」都没有，检查脚本管理器是否开启。新版 Chrome 需要在扩展详情页打开 Tampermonkey 的「允许运行用户脚本」（或者开启开发者模式），否则所有用户脚本都不会运行。

## 局限

- 按域名规则分类，不对每个节点单独测速；PCDN 或第三方节点在你的网络下如果其实很快，可以在面板里重新打开；
- 接口没给 upos 备用地址时无法切到官方源（这时保持原样）；
- 只对网页生效。B 站 App 可以在 Clash / 路由器上加 `DOMAIN-SUFFIX,mountaintoys.cn,REJECT`、`DOMAIN-SUFFIX,mcdn.bilivideo.cn,REJECT`、`DOMAIN-REGEX,^cn-[a-z0-9]+-fx-,REJECT`，让这些节点立即失败（未实测）。

## 更新日志

- **2.0.0**：按节点类型过滤（PCDN / 第三方边缘 / B站自建）；upos 自动测速选最快镜像；新增悬浮设置面板。默认只用官方源。
- **1.0.0**：首个版本，只绕过 `cn-*-fx-*` 节点。
