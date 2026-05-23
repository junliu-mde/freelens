---
name: freelens-clean-build
description: Use when changing Freelens renderer UI, desktop startup behavior, or packaged assets on macOS and you need a reliable clean rebuild. Covers cache cleanup, core and freelens rebuild order, runtime bundle verification, app.asar checks, manual bundle sync when freelens.js is stale, and safe replacement of /Applications/Freelens.app.
---

# Freelens Clean Build

## 什么时候用

- 改了 `packages/core/src/renderer`、`packages/core/src/main`、`freelens/src`、`freelens/static`
- 源码已经是新的，App 里还是旧 UI
- `pnpm build:app:dir` 看起来成功，但跑出来还是旧包
- 清过 `freelens/static/build` 之后 App 起不来
- 你怀疑 Turbo 缓存、资源打包或 `app.asar` 里还是旧内容

## 最稳的构建顺序

从仓库根目录开始跑，不要只 build `packages/core`：

```bash
osascript -e 'tell application "Freelens" to quit' || true
rm -rf .turbo packages/core/dist packages/core/static/build freelens/dist freelens/static/build
cd packages/core && npm exec -- pnpm build
cd /Users/jun.c.liu/source/freelens/freelens && npm exec -- pnpm build
cd /Users/jun.c.liu/source/freelens/freelens && npm exec -- pnpm build:resources
cd /Users/jun.c.liu/source/freelens/freelens && npm exec --package electron-builder@26.11.1 -- electron-builder --publish never --macos dir
```

如果仓库路径变了，把上面的绝对路径改掉。

## 真正要看的产物

不要只看源码和 `packages/core` 的 bundle。

- `packages/core/static/build/library/renderer.js`
  这是 core library bundle，只能说明 core 这层编出来了
- `freelens/static/build/freelens.js`
  这是桌面 App 运行时真正吃到的 renderer bundle
- `freelens/dist/mac-arm64/Freelens.app/Contents/Resources/app.asar`
  这是打包后的最终真相

先看 `freelens/static/build/freelens.js`，再看 `app.asar`。如果这两个还是旧的，源码再新也没用。

## 先验包，再换 App

挑一个能证明 UI 真的变了的唯一字符串去查，比如一个新文案、一个新 class 名，或者一个只在新版本里出现的组件名。

```bash
tmpdir=$(mktemp -d)
cd "$tmpdir"
npm exec --package @electron/asar@4.2.0 -- \
  asar extract-file /Users/jun.c.liu/source/freelens/freelens/dist/mac-arm64/Freelens.app/Contents/Resources/app.asar static/build/freelens.js
rg -n "你的唯一字符串" "$tmpdir/freelens.js"
```

如果这里只能搜到旧内容，不要急着替换 `/Applications/Freelens.app`，先回去修构建链路。

## AI Agent 改动的特殊坑

这次 AI chat / agent console 这类改动，最容易出现“源码对了，运行时 bundle 没跟上”的假象。

遇到这种情况先做这几步：

```bash
rg -n "你的唯一字符串" packages/core/static/build/library/renderer.js
rg -n "你的唯一字符串" freelens/static/build/freelens.js
```

判断规则很简单：

- 两边都有：大概率已经进到运行时 bundle 了，继续查 `app.asar`
- 只有 `packages/core` 里有：`freelens/static/build/freelens.js` 还是旧的
- `freelens/static/build/freelens.js` 有，但 App 里没看到：去查打包出来的 `app.asar`

如果 `freelens/static/build/freelens.js` 一直不跟，可以手动同步这次改动对应的 JS/CSS 片段再重新打包。这个兜底法适合前端大改动，尤其是 AI Agent 这块。

## 安全替换本机 App

确认打包出来的是对的，再替换本机 App：

```bash
stamp=$(date +%Y%m%d-%H%M%S)
mv /Applications/Freelens.app "/Applications/Freelens.app.backup-$stamp"
mv /Users/jun.c.liu/source/freelens/freelens/dist/mac-arm64/Freelens.app /Applications/Freelens.app
```

## 起不来时怎么查

直接从终端拉起，先看第一条真错误：

```bash
/Applications/Freelens.app/Contents/MacOS/Freelens
```

常见情况是 `static/build/` 里的资源缺了，而不是代码本身坏了。

## 2026-05-25 这次踩到的坑

- `pnpm build:app:dir` 可能会复用 Turbo 缓存，日志看着像重新构建，实际产物还是旧的
- 只验证 `packages/core/static/build/library/renderer.js` 没意义，真正跑的是 `freelens/static/build/freelens.js`
- 打包前一定查一次 `app.asar`，不要只信源码目录和 build 目录
- 清掉 `freelens/static/build` 之后，如果没重跑 `npm exec -- pnpm build:resources`，App 可能因为 tray 之类的资源缺失直接起不来
- AI Agent 这种 UI 重构，必要时要手动同步 `freelens.js` 和 `freelens.css`，不要只等构建链自己传下去
- 新增 AI tab 的纯 UI 字段时一定给默认值，老的本地持久化数据可能缺字段
- 任何会对 `title`、首条消息之类做 `.trim()` 的地方，都先兜底成空字符串，不然旧 session 一加载就白屏

## 快速排查顺序

### App 里还是旧 UI

1. 查 `freelens/static/build/freelens.js`
2. 查打包后的 `app.asar`
3. 确认无误后再替换 `/Applications/Freelens.app`

### App 完全起不来

1. 跑 `/Applications/Freelens.app/Contents/MacOS/Freelens`
2. 看是不是 `static/build/` 下资源缺失
3. 重跑 `npm exec -- pnpm build:resources`

### 改了 AI Agent 但界面没变

1. 用唯一字符串同时查 `packages/core/static/build/library/renderer.js` 和 `freelens/static/build/freelens.js`
2. 再查打包产物里的 `app.asar`
3. 必要时手动同步 runtime bundle 片段后再打包
