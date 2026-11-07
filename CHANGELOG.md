# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## 0.3.2

- The band above the prompt no longer hides other plugins' bands there: what they draw shows beneath it.

## 0.3.1

- Fewer "dropped some code or a path" failures: the blocks the app adds around a prompt are no longer sent to be translated, placeholders the model writes back slightly differently are accepted, and a reply that loses one is asked for once more.

## [0.3.0] - 2026-11-05

### Added
- An **Options** button on the band that opens an Engine picker (Claude model or Google Translate)
  and a Model picker (session's model, haiku, sonnet, opus, or the one set); a pick writes the
  setting and says what changed. With Google and no key set, the band says how to add one. On
  mobile, which draws no picker, it names the commands instead.

## [0.2.0] - 2026-11-05

### Added
- Google Cloud Translation as an optional engine: settings `engine` (`model` or `google`) and
  `googleApiKey` (sensitive), and `/translate engine google|model`. Code and paths stay out of
  Google's reach; where Google fails, has no key or no code for the language, the model translates,
  with a notice. The status line and band say when Google is in use.

### Removed
- `/translate last`: the band above the prompt shows what was typed and what was sent.

### Fixed
- The prompt and command hooks fall back safely if they ever throw: the prompt is still sent.

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
- `/translate [on | off | toggle | model <name> | <language>]`.
- A cache of the last 50 translations, so the same words sent again cost no call.
- Settings: `language`, `model`, `enabled`.
