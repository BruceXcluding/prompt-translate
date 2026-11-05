import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register, RenderChildren } from 'claude-code'

import type { Last, Settings } from '../types'
import {
  errorText,
  isPlainlyIn,
  isWordless,
  languageName,
  mask,
  oneLine,
  promptFor,
  readReply,
  systemFor,
  unmask,
  visible,
} from './core'
import type { Reply } from './core'

const COMMAND = 'translate'
// How much of a translation the band shows; "/translate last" has the rest.
const BAND_CHARS = 1500
// Translations kept for a prompt sent again, keyed by its masked text.
const CACHE_SIZE = 50
const TIMEOUT_MS = 60_000
// Columns of the band's Typed / Sent labels.
const LABEL_COLUMNS = 7

// This session's choice; null until a command sets it, the options standing in.
const settings = atom({ plugin: 'prompt-translate', key: 'settings' } as const, null, { shape: 'settings-1' })
const last = atom({ plugin: 'prompt-translate', key: 'last' } as const, null, { shape: 'last-2' })
const isCollapsed = atom({ plugin: 'prompt-translate', key: 'isCollapsed' } as const, false)
const isTranslating = atom({ plugin: 'prompt-translate', key: 'isTranslating' } as const, false)

type Outcome = Pick<Last, 'sent' | 'outcome' | 'reason'>

// ─── Helpers ────────────────────────────────────────────────────────────────

// Prompts a person wrote: typed, sent from a phone or the SDK host, or a
// plugin's sent as theirs. Notifications, peers and loops pass as they are.
function isTyped(origin: PromptOrigin | undefined): boolean {
  if (origin === undefined) return true
  switch (origin.kind) {
    case 'composer':
    case 'bridge':
    case 'sdk':
    case 'unclassified':
      return true
    case 'plugin':
      return origin.asUser === true
    default:
      return false
  }
}

async function current($: EngineInterface, fallback: Settings): Promise<Settings> {
  return ((await read($, settings)) as Settings | null) ?? fallback
}

async function save($: EngineInterface, next: Settings): Promise<void> {
  await update($, settings, () => next)
  showStatus($, next)
}

function showStatus($: EngineInterface, s: Settings): void {
  $.ui.status(s.enabled ? `Translate → ${s.language}` : undefined)
}

function clip(text: string): string {
  return text.length > BAND_CHARS ? `${text.slice(0, BAND_CHARS)}… ("/translate last" shows it all)` : text
}

function describe(shown: Last): string {
  const received =
    shown.outcome === 'translated'
      ? `The model received (${shown.language}):`
      : shown.outcome === 'same'
        ? `The model received it as typed (already in ${shown.language}):`
        : `The model received it as typed (translation failed: ${shown.reason ?? 'unknown'}):`

  return `You typed:\n\n${shown.original}\n\n${received}\n\n${shown.sent}`
}

// ─── Translating ───────────────────────────────────────────────────────────

// Replies kept for words sent again, least recently used dropped first.
type Cache = Map<string, Reply>

// The model's reply for the masked words, or why there is none. The same
// words asked again, to the same model and language, cost no second call.
async function ask($: EngineInterface, masked: string, language: string, model: string, cache: Cache): Promise<Reply | string> {
  const use = model !== '' ? model : await $.session.model()
  const key = `${use}\u0000${language}\u0000${masked}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)

    return hit
  }
  const r = await $.model.complete({
    model: use,
    system: systemFor(language),
    prompt: promptFor(masked),
    maxTokens: Math.min(16_000, Math.max(1024, masked.length * 4)),
    // Translating needs no deliberation; dropped for a model without effort.
    effort: 'low',
    timeoutMs: TIMEOUT_MS,
  })
  if (!r.isAnswered) {
    return `${use}: ${r.reason === 'api-error' ? `${r.error}${r.status ? ` ${r.status}` : ''}` : r.reason}`
  }
  const reply = readReply(r.text)
  cache.set(key, reply)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)

  return reply
}

// The prompt in `language` ('' model: the session's own), or as typed with why.
async function translate($: EngineInterface, text: string, language: string, model: string, cache: Cache): Promise<Outcome> {
  const masked = mask(text)
  if (isWordless(masked.text) || isPlainlyIn(language, masked.text)) return { sent: text, outcome: 'same' }
  try {
    const reply = await ask($, masked.text, language, model, cache)
    if (typeof reply === 'string') return { sent: text, outcome: 'failed', reason: reply }
    if (reply.kind === 'same') return { sent: text, outcome: 'same' }
    const sent = unmask(reply.text, masked.spans)
    if (sent === undefined) return { sent: text, outcome: 'failed', reason: 'the translation dropped some code or a path' }
    if (sent.trim() === '') return { sent: text, outcome: 'failed', reason: 'the translation came back empty' }

    return { sent, outcome: sent === text ? 'same' : 'translated' }
  } catch (err) {
    return { sent: text, outcome: 'failed', reason: errorText(err) }
  }
}

// ─── The command ───────────────────────────────────────────────────────────

type Command =
  | { kind: 'status' }
  | { kind: 'on' }
  | { kind: 'off' }
  | { kind: 'toggle' }
  | { kind: 'last' }
  | { kind: 'model'; name: string }
  | { kind: 'language'; name: string }

function parse(args: string): Command {
  const arg = args.trim()
  const model = /^model(?:\s+(.*))?$/i.exec(arg)
  if (model) return { kind: 'model', name: (model[1] ?? '').trim() }
  if (arg === '' || /^(status|状态)$/i.test(arg)) return { kind: 'status' }
  if (/^(on|start|开|开启)$/i.test(arg)) return { kind: 'on' }
  if (/^(off|stop|关|关闭)$/i.test(arg)) return { kind: 'off' }
  if (/^(toggle|切换)$/i.test(arg)) return { kind: 'toggle' }
  if (/^(last|sent|上一条|最后)$/i.test(arg)) return { kind: 'last' }

  return { kind: 'language', name: languageName(arg) }
}

async function setModel($: EngineInterface, name: string): Promise<string> {
  const value = /^(default|session|默认)$/i.test(name) ? '' : name
  try {
    const rows = await $.config.list()
    const key = rows.find(row => /^prompt-translate(@[^.]+)?\.model$/.test(row.key))?.key
    if (key === undefined) return 'The translation model was not changed: its setting is not in /config.'
    const r = await $.config.set({ key, value })
    if (r.deny !== undefined) return `The translation model was not changed: ${r.deny}`
  } catch (err) {
    return `The translation model was not changed: ${errorText(err)}`
  }

  return value === '' ? "Translating with the session's own model from now on." : `Translating with ${value} from now on.`
}

// ─── Hooks ─────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  const typedLanguage = typeof options.language === 'string' ? options.language.trim() : ''
  const defaults: Settings = {
    enabled: options.enabled !== false,
    language: languageName(typedLanguage !== '' ? typedLanguage : 'English'),
  }
  const model = typeof options.model === 'string' ? options.model.trim() : ''
  const cache: Cache = new Map()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description:
        'Translate your prompts before they are sent: "/translate off", "/translate on", "/translate <language>", "/translate last" to see what the model received, or "/translate model <name>"',
      argumentHint: '[on | off | last | model <name> | <language>]',
    })
    showStatus($, await current($, defaults))

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const command = parse(e.args)
    const before = await current($, defaults)
    switch (command.kind) {
      case 'last': {
        const shown = await read($, last)

        return { text: shown === null ? 'Nothing has been sent since translation was turned on.' : describe(shown) }
      }
      case 'model': {
        if (command.name !== '') return { text: await setModel($, command.name) }
        const using = model !== '' ? model : `the session's own model (${await $.session.model()})`

        return {
          text: `Translating with ${using}. "/translate model <name>" changes it; "/translate model default" goes back to the session's model.`,
        }
      }
      case 'status':
        break
      case 'on':
      case 'off':
      case 'toggle':
        await save($, { ...before, enabled: command.kind === 'toggle' ? !before.enabled : command.kind === 'on' })
        break
      case 'language':
        await save($, { enabled: true, language: command.name })
        break
    }
    await update($, isCollapsed, () => false)
    const after = await current($, defaults)

    return {
      text: after.enabled
        ? `Translation is on: prompts are sent to the model in ${after.language}.`
        : 'Translation is off: prompts are sent as typed. "/translate on" turns it back on.',
    }
  }).catch(() => ({ text: 'prompt-translate: the command failed; the debug log has why.' }))

  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta || !isTyped(e.origin)) return next(e)
    // A slash line no command took, or a shell line, goes as typed.
    const typed = visible(e.text)
    if (typed === '' || /^[/!]/.test(typed)) return next(e)
    const s = await current($, defaults)
    if (!s.enabled) return next(e)

    // The prompt waits on the translation: the status line says so meanwhile.
    $.ui.status(`Translating → ${s.language}…`)
    await update($, isTranslating, () => true)
    const result = await translate($, e.text, s.language, model, cache)
    await update($, isTranslating, () => false)
    showStatus($, s)
    // Kept as the person reads it, the host's blocks left out.
    await update($, last, () => ({ ...result, original: typed, sent: visible(result.sent), language: s.language }))
    await update($, isCollapsed, () => false)
    if (result.outcome === 'failed') {
      $.ui.toast(`Translation failed (${oneLine(result.reason ?? 'unknown', 120)}); sent your original text.`)
    }

    return next(result.outcome === 'translated' ? { ...e, text: result.sent } : e)
  }).catch(async ($, e, next) => {
    // Whatever failed, the prompt still goes: as translated if it got that far,
    // else as typed.
    await update($, isTranslating, () => false)

    return next(e)
  })

  // A band above the prompt: that translation is on and into which language,
  // and the last prompt as typed beside what the model received.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await current($, defaults)
    if (e.props.hasSurvey || !s.enabled) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const shown = await read($, last)
    const isBusy = await read($, isTranslating)
    const isOpen = shown !== null && !(await read($, isCollapsed))
    // The row's width less the label column and the band's own margin.
    const width = Math.max(30, e.props.bodyColumns - LABEL_COLUMNS - 2)

    const row = (label: string, body: RenderChildren) => (
      <Box key={label} flexDirection="row">
        <Box width={LABEL_COLUMNS} flexShrink={0}>
          <Text color="subtle">{label}</Text>
        </Box>
        <Box flexShrink={1}>{body}</Box>
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap="xs">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text color="suggestion" bold>
            ⇄ Translating into {s.language}
          </Text>
          <Box flexDirection="row" columnGap="sm">
            {shown === null ? null : isOpen ? (
              <Button key="collapse" label="Hide" plain dimColor onPress={() => update($, isCollapsed, () => true)} />
            ) : (
              <Button key="expand" label="Show last" plain dimColor onPress={() => update($, isCollapsed, () => false)} />
            )}
            <Button key="off" label="Turn off" plain dimColor onPress={() => save($, { ...s, enabled: false })} />
          </Box>
        </Box>
        {isBusy ? (
          <Text color="subtle" italic>
            Translating your prompt…
          </Text>
        ) : shown === null ? (
          <Text color="subtle">What you type is sent to the model in {s.language}.</Text>
        ) : !isOpen ? null : shown.outcome === 'translated' ? (
          <Box flexDirection="column">
            {row('Typed', <Text color="subtle">{oneLine(shown.original, width)}</Text>)}
            {row('Sent', <Text wrap="wrap">{clip(shown.sent)}</Text>)}
          </Box>
        ) : shown.outcome === 'same' ? (
          <Text color="subtle">✓ Sent as typed: already in {shown.language}.</Text>
        ) : (
          <Text color="warning">
            ⚠ Sent as typed: translation failed ({oneLine(shown.reason ?? 'unknown', 80)}).
          </Text>
        )}
      </Box>
    )
  })
}
