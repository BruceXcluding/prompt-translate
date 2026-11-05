# prompt-translate

<p align="center"><a href="./README.md">English</a> | <a href="./README.zh-CN.md">中文</a></p>

<p align="center"><strong>用任何语言输入，Claude Code 收到的是同一种语言。</strong></p>

<p align="center">
<a href="https://github.com/BruceXcluding/prompt-translate/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/BruceXcluding/prompt-translate/ci.yml?branch=main&style=flat-square&label=tests" alt="tests"></a>
<a href="./LICENSE"><img src="https://img.shields.io/github/license/BruceXcluding/prompt-translate?style=flat-square" alt="license"></a>
</p>

---

一个 Claude Code 插件：在提示词发送给模型之前，把你在输入框里输入的内容翻译成目标语言（默认英文）。无论你用中文、英文还是其他语言输入，模型收到的都是目标语言。

- **原样保留：** 代码块与行内代码、URL、`@file` 引用、文件路径和标识符（`parseConfig()`、`snake_case`、`camelCase`、`a.b.c`）。它们在发送给翻译模型前被替换为占位符，翻译后再放回；丢失占位符的译文会被丢弃。
- **不翻译：** 斜杠命令、已经是目标语言的提示词（文字本身足以判断时不调用模型：目标为英文时的纯 ASCII，目标为中文、日文或韩文时不含拉丁字母的对应文字）、只有代码的提示词，以及通知和其他会话的消息。
- **翻译失败时** 发送原文，并给出简短提示。
- **可见：** 输入框上方的横条显示目标语言、你输入的原文和模型实际收到的完整译文（聊天气泡里仍显示原文，模型只读到译文）；开启时状态栏显示 `Translate → <语言>`。


## 安装

在终端版 Claude Code 的输入框中：

```
/plugin install prompt-translate --marketplace BruceXcluding/prompt-translate
```

输入 `y` 添加 marketplace，再选择范围（第一项是 user）。在 shell 中：

```bash
claude plugin install prompt-translate --marketplace BruceXcluding/prompt-translate
```

在桌面应用中（`/plugin` 不可用）：点击输入框旁的 **+**，选择 **Plugins**，用 `BruceXcluding/prompt-translate` **Add marketplace**，再 **Add plugin**。

翻译使用你自己的 Claude Code 连接：会话自身的模型，或用 `/translate model` 设置的模型。每条被翻译的提示词会多一次简短的模型调用。

## 命令

- `/translate`：查看当前状态
- `/translate model <名称>`：用其他模型翻译，例如 `haiku`；`/translate model default` 恢复为会话自身的模型
- `/translate off` · `/translate on`：在本会话中关闭或开启
- `/translate engine google` · `/translate engine model`：改用 Google 翻译或模型翻译
- `/translate <语言>`：改为翻译成其他语言（`zh`、`Japanese`、`中文`、`fr` 等）

## 设置

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `language` | `English` | 提示词发送时使用的语言 |
| `model` | 空 | 用于翻译的更便宜的模型；留空则使用会话自身的模型 |
| `enabled` | `true` | 会话开始时是否开启翻译 |
| `engine` | `model` | `model`：由 Claude Code 的模型翻译；`google`：由 Google Cloud Translation 翻译 |
| `googleApiKey` | 空 | Google Cloud Translation API 密钥，仅用于 `google` 引擎；保存在系统安全存储中 |

### Google 翻译

把 `engine` 设为 `google`（或运行 `/translate engine google`），并在终端会话中用
`/plugin configure prompt-translate@prompt-translate` 把 API 密钥填入 `googleApiKey`。Google 速度快、不调用模型；模型对技术类提示词更细致。

- 使用官方 Cloud Translation API，需要开通了结算的 Google Cloud 项目。每月前 50 万字符免费，之后约每百万字符 20 美元。
- 提示词（去掉代码、路径和 `@file` 引用后）会发送给 Google。密钥放在请求头中，不会出现在 URL 里。
- Google 出错、未设置密钥或不支持目标语言时，改由模型翻译，并给出提示。

## 开发

```bash
git clone https://github.com/BruceXcluding/prompt-translate
cd prompt-translate
claude --plugin-dir .      # 从本地加载，修改后自动重新加载
claude plugin validate .
claude plugin test .       # 模型是模拟的：不调用、不消耗 token
```

## 许可证

MIT
