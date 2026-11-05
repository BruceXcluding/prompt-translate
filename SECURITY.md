# Security and privacy

## What prompt-translate sends and keeps

- **Sends:** each prompt that needs translating goes to a model through your own Claude Code
  connection (the session's model, or the one in the `model` setting), the same provider and
  account your chat uses. Code, paths, URLs and `@file` mentions are replaced by placeholders
  first, so they are not part of that request.
- **With engine `google` only:** the same masked prompt goes to Google Cloud Translation
  (`translation.googleapis.com`), with your `googleApiKey` in the `X-Goog-Api-Key` header. With the
  default engine `model`, nothing goes to Google or any other translation service.
- **Never:** any other network request, and no file is read.
- **Keeps:** the last prompt as typed and as sent, in the session's state, for the band; and up to 50 recent translations in memory, gone when the session ends.
- **API keys:** the mod never sees your model provider's key; Claude Code makes the model call.
  The Google key is a sensitive setting, kept in your system's secure storage, never written to
  `settings.json`, the band, a toast or the transcript.

## Reporting a vulnerability

Please open a [private security advisory](https://github.com/BruceXcluding/prompt-translate/security/advisories/new)
rather than a public issue.
