# Security and privacy

## What prompt-translate sends and keeps

- **Sends:** each prompt that needs translating goes to a model through your own Claude Code
  connection (the session's model, or the one in the `model` setting), the same provider and
  account your chat uses. Code, paths, URLs and `@file` mentions are replaced by placeholders
  first, so they are not part of that request.
- **Never sends:** anything to a third-party translation service. The mod makes no other
  network requests and reads no files.
- **Keeps:** the last prompt as typed and as sent, in the session's state, for the band and
  `/translate last`; and up to 50 recent translations in memory, gone when the session ends.
- **API keys:** the mod never reads, stores or sees one; Claude Code makes the model call.

## Reporting a vulnerability

Please open a [private security advisory](https://github.com/BruceXcluding/prompt-translate/security/advisories/new)
rather than a public issue.
