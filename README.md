# prompt-translate

<p align="center"><a href="./README.md">English</a> | <a href="./README.zh-CN.md">中文</a></p>

<p align="center"><strong>Type in any language. Claude Code receives your prompt in one.</strong></p>

<p align="center">
<a href="https://github.com/BruceXcluding/prompt-translate/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/BruceXcluding/prompt-translate/ci.yml?branch=main&style=flat-square&label=tests" alt="tests"></a>
<a href="./LICENSE"><img src="https://img.shields.io/github/license/BruceXcluding/prompt-translate?style=flat-square" alt="license"></a>
</p>

---

A Claude Code plugin that translates whatever you type in the prompt box into one target language before it is sent to the model. Type in Chinese, English or anything else; the model always receives the prompt in the target language (English by default).

- **Kept verbatim:** fenced and inline code, URLs, `@file` mentions, file paths and identifiers (`parseConfig()`, `snake_case`, `camelCase`, `a.b.c`). They are swapped for placeholders before the model sees the text and put back after; a translation that loses one is discarded.
- **Passed through unchanged:** slash commands, prompts already in the target language (no model call when the script settles it: plain ASCII for English, Chinese, Japanese or Korean text with no Latin words for those targets), and prompts that are only code. Notifications and messages from other sessions are never touched.
- **On failure** the original text is sent, with a short notice.
- **See what was sent:** a band above the prompt shows the target language, what you typed and, in full, what the model received. The chat bubble keeps your original text; the model reads only the translation. The status line shows `Translate → <language>` while it is on.


## Install

At the prompt of a terminal Claude Code session:

```
/plugin install prompt-translate --marketplace BruceXcluding/prompt-translate
```

Answer `y` to add the marketplace, then pick a scope (user is first). From a shell:

```bash
claude plugin install prompt-translate --marketplace BruceXcluding/prompt-translate
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `BruceXcluding/prompt-translate`, then **Add plugin**.

Translation uses your own Claude Code connection: the session's model, or the one you set with `/translate model`. Each translated prompt costs one short model call.

## Commands

- `/translate`: show whether translation is on
- `/translate model <name>`: translate with another model, e.g. `haiku`; `/translate model default` goes back to the session's model
- `/translate off` · `/translate on`: switch it for this session
- `/translate engine google` · `/translate engine model`: translate with Google Translate or with the model
- `/translate <language>`: translate into another language from now on (`zh`, `Japanese`, `中文`, `fr`, ...)

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `language` | `English` | The language prompts are sent in |
| `model` | empty | A cheaper model for translating; empty uses the session's own model |
| `enabled` | `true` | Whether translation is on when a session starts |
| `engine` | `model` | `model`: your Claude Code model translates. `google`: Google Cloud Translation does |
| `googleApiKey` | empty | Your Google Cloud Translation API key, for engine `google`; kept in secure storage |

### Google Translate

Set `engine` to `google` (or run `/translate engine google`) and add a Cloud Translation API key as
`googleApiKey` with `/plugin configure prompt-translate@prompt-translate` in a terminal session. Google is
fast and needs no model call; the model is more careful with technical prompts.

- It uses the official Cloud Translation API, which needs a Google Cloud project with billing on.
  The first 500,000 characters a month are free, then about $20 per million.
- Your prompt, with code, paths and `@file` mentions taken out, goes to Google. The key travels in a
  request header, never in the URL.
- Where Google fails, has no key, or has no code for the target language, the model translates instead,
  with a notice.

## Development

```bash
git clone https://github.com/BruceXcluding/prompt-translate
cd prompt-translate
claude --plugin-dir .      # load it from disk; edits reload live
claude plugin validate .
claude plugin test .       # the model is simulated: no calls, no tokens
```

| Path | What it is |
| --- | --- |
| `hooks/core.ts` | Engine-free parts: masking code and paths, the script check, the request and reading the reply |
| `hooks/register.tsx` | The hooks: `prompt.submit`, `/translate`, the band above the prompt, the status line |
| `types/index.d.ts` | The session state the mod keeps |
| `tests/translate.test.tsx` | Tests run by `claude plugin test` |

See [CHANGELOG.md](CHANGELOG.md) for what changed, and [SECURITY.md](SECURITY.md) for what the mod sends and keeps.

## License

MIT
