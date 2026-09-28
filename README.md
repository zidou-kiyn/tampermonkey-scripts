# tampermonkey-scripts

我自己用的油猴（用户脚本）合集。

## 脚本列表

| 脚本 | 说明 | 安装 |
|---|---|---|
| [bilibili-cdn-fix](scripts/bilibili-cdn-fix/) | 绕过 B 站连不上的 CDN 节点，解决悬浮预览、起播慢的问题 | [安装](https://raw.githubusercontent.com/zidou-kiyn/tampermonkey-scripts/main/scripts/bilibili-cdn-fix/bilibili-cdn-fix.user.js) |

## 怎么安装

1. 先装一个用户脚本管理器：[Tampermonkey](https://www.tampermonkey.net/)、[ScriptCat](https://scriptcat.org/) 或 [Violentmonkey](https://violentmonkey.github.io/)。
   - 较新的 Chrome/Edge 要在扩展详情页打开“允许用户脚本”（有的版本是打开扩展页的“开发者模式”）。
2. 点上表里的“安装”链接，管理器会弹出安装页面。
3. 脚本里写了 `@updateURL`，管理器会自动检查更新。

## 目录结构

```
tampermonkey-scripts/
├── README.md                 # 总索引（本文件）
├── LICENSE
├── templates/
│   └── template.user.js      # 新脚本模板
└── scripts/
    └── <脚本名>/
        ├── <脚本名>.user.js  # 脚本本体
        └── README.md         # 原理、配置、排查记录、更新日志
```

## 新增一个脚本

1. 复制 `templates/template.user.js` 到 `scripts/<脚本名>/<脚本名>.user.js`，脚本名用小写短横线，例如 `github-xxx`；
2. 把元数据里的 `<脚本名>` 全部替换掉，填好 `@name`、`@description`、`@match`；
3. 在同一个目录里写一份 `README.md`；
4. 在上面的“脚本列表”里加一行。

## 发布更新

改完脚本后**一定要把 `@version` 调大**，不然管理器检测不到更新。版本号按 `主.次.修订` 来：

- 修 bug：`1.0.0` → `1.0.1`
- 加功能：`1.0.1` → `1.1.0`
- 不兼容的改动：`1.1.0` → `2.0.0`

## License

[MIT](LICENSE)
