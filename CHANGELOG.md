# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-05

### Added
- A `prompt.submit` hook that translates each typed prompt into a target language
  (English by default) before the model sees it, with the session's own model or a
  `model` setting.
- Code blocks, inline code, URLs, `@file` mentions, paths, folders and identifiers are
  kept verbatim behind placeholders; a translation that loses one falls back to the original.
- No model call when the script settles it (plain ASCII for English; Chinese, Japanese
  or Korean with no Latin words), for slash commands, code-only prompts, notifications
  and messages from other sessions.
- A band above the prompt showing the language, what was typed and what was sent, with
  Hide and Turn off; a `Translate → <language>` status line entry.
- `/translate [on | off | toggle | last | model <name> | <language>]`.
- A cache of the last 50 translations, so the same words sent again cost no call.
- Settings: `language`, `model`, `enabled`.
