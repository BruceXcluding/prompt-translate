import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register, RenderChildren } from 'claude-code'

import type { Engine, Last, Settings } from '../types'
import {
  GOOGLE_URL,
  errorText,
  googleCode,
  googleHtml,
  isPlainlyIn,
  isWordless,
  languageName,
  mask,
  oneLine,
  promptFor,
  readGoogle,
  readReply,
  systemFor,
  unmask,
  visible,
} from './core'
import type { Reply } from './core'

const COMMAND = 'translate'
// How much of a translation the band shows before it is cut.
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

type Outcome = Pick<Last, 'sent' | 'outcome' | 'reason' | 'engine' | 'notice'>

// How prompts are translated, from the settings: the engine, the model for
// it ('' for the session's own) and Google's key ('' when none is set).
type Setup = { engine: Engine; model: string; googleKey: string }

const ENGINE_NAMES: Readonly<Record<Engine, string>> = { model: 'the model', google: 'Google Translate' }

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

async function save($: EngineInterface, next: Settings, engine: Engine): Promise<void> {
  await update($, settings, () => next)
  showStatus($, next, engine)
}

function showStatus($: EngineInterface, s: Settings, engine: Engine): void {
  $.ui.status(s.enabled ? `Translate → ${s.language}${engine === 'google' ? ' · Google' : ''}` : undefined)
}

function clip(text: string): string {
  return text.length > BAND_CHARS ? `${text.slice(0, BAND_CHARS)}…` : text
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

// Google's reply for the masked words, or why there is none, cached as the
// model's replies are.
async function askGoogle($: EngineInterface, masked: string, language: string, key: string, cache: Cache): Promise<Reply | string> {
  const target = googleCode(language)
  if (target === undefined) return `Google Translate has no code for ${language}`
  const cacheKey = `google\u0000${target}\u0000${masked}`
  const hit = cache.get(cacheKey)
  if (hit !== undefined) {
    cache.delete(cacheKey)
    cache.set(cacheKey, hit)

    return hit
  }
  const r = await $.http.fetch(GOOGLE_URL, {
    method: 'POST',
    // The key rides a header, never the URL.
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Goog-Api-Key': key },
    body: JSON.stringify({ q: googleHtml(masked), target, format: 'html' }),
  })
  const reply = readGoogle(r.status, r.text, target)
  if (reply.kind === 'error') return reply.reason
  cache.set(cacheKey, reply)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)

  return reply
}

// A reply as the prompt to send, or why it cannot be sent.
function settle(text: string, reply: Reply, spans: readonly string[], engine: Engine): Outcome {
  if (reply.kind === 'same') return { sent: text, outcome: 'same', engine }
  const sent = unmask(reply.text, spans)
  if (sent === undefined) return { sent: text, outcome: 'failed', reason: 'the translation dropped some code or a path' }
  if (sent.trim() === '') return { sent: text, outcome: 'failed', reason: 'the translation came back empty' }

  return { sent, outcome: sent === text ? 'same' : 'translated', engine }
}

// The prompt in `language`, or as typed with why. With engine google and a
// key, Google translates; where it cannot, the model does, with a notice.
async function translate($: EngineInterface, text: string, language: string, setup: Setup, cache: Cache): Promise<Outcome> {
  const masked = mask(text)
  if (isWordless(masked.text) || isPlainlyIn(language, masked.text)) return { sent: text, outcome: 'same' }
  let notice: string | undefined
  try {
    if (setup.engine === 'google') {
      if (setup.googleKey === '') {
        notice = 'No Google API key is set; the model translated instead.'
      } else {
        const google = await askGoogle($, masked.text, language, setup.googleKey, cache).catch(errorText)
        if (typeof google !== 'string') return settle(text, google, masked.spans, 'google')
        notice = `${google}; the model translated instead.`
      }
    }
    const reply = await ask($, masked.text, language, setup.model, cache)
    if (typeof reply === 'string') return { sent: text, outcome: 'failed', reason: notice ? `${notice} ${reply}` : reply }

    return { ...settle(text, reply, masked.spans, 'model'), notice }
  } catch (err) {
    return { sent: text, outcome: 'failed', reason: errorText(err), notice }
  }
}

// ─── The command ───────────────────────────────────────────────────────────

type Command =
  | { kind: 'status' }
  | { kind: 'on' }
  | { kind: 'off' }
  | { kind: 'toggle' }
  | { kind: 'model'; name: string }
  | { kind: 'engine'; name: string }
  | { kind: 'language'; name: string }

function parse(args: string): Command {
  const arg = args.trim()
  const option = /^(model|engine)(?:\s+(.*))?$/i.exec(arg)
  if (option) return { kind: option[1]!.toLowerCase() as 'model' | 'engine', name: (option[2] ?? '').trim() }
  if (arg === '' || /^(status|状态)$/i.test(arg)) return { kind: 'status' }
  if (/^(on|start|开|开启)$/i.test(arg)) return { kind: 'on' }
  if (/^(off|stop|关|关闭)$/i.test(arg)) return { kind: 'off' }
  if (/^(toggle|切换)$/i.test(arg)) return { kind: 'toggle' }

  return { kind: 'language', name: languageName(arg) }
}

// Writes one of the mod's settings as the /config menu would; the module
// reloads with it. The answer is what to tell the person.
async function setOption($: EngineInterface, field: 'model' | 'engine', value: string, done: string): Promise<string> {
  const what = field === 'model' ? 'translation model' : 'translation engine'
  try {
    const pattern = new RegExp(`^prompt-translate(@[^.]+)?\\.${field}$`)
    const key = (await $.config.list()).find(row => pattern.test(row.key))?.key
    if (key === undefined) return `The ${what} was not changed: its setting is not in /config.`
    const r = await $.config.set({ key, value })
    if (r.deny !== undefined) return `The ${what} was not changed: ${r.deny}`
  } catch (err) {
    return `The ${what} was not changed: ${errorText(err)}`
  }

  return done
}

async function modelCommand($: EngineInterface, name: string, model: string): Promise<string> {
  if (name === '') {
    const using = model !== '' ? model : `the session's own model (${await $.session.model()})`

    return `The model translating is ${using}. "/translate model <name>" changes it; "/translate model default" goes back to the session's model.`
  }
  const value = /^(default|session|默认)$/i.test(name) ? '' : name

  return setOption(
    $,
    'model',
    value,
    value === '' ? "Translating with the session's own model from now on." : `Translating with ${value} from now on.`,
  )
}

async function engineCommand($: EngineInterface, name: string, setup: Setup): Promise<string> {
  const keyNote =
    setup.googleKey === ''
      ? ' No Google API key is set yet: add one as googleApiKey in the plugin\'s settings (/plugin configure, in a terminal session); until then the model translates.'
      : ''
  if (name === '') {
    return `Prompts are translated by ${ENGINE_NAMES[setup.engine]}. "/translate engine google" or "/translate engine model" switches.${setup.engine === 'google' ? keyNote : ''}`
  }
  const engine = name.toLowerCase()
  if (engine !== 'model' && engine !== 'google') return 'The engine is "model" or "google".'
  const done =
    engine === 'google'
      ? `Translating with Google Translate from now on: prompts, with code and paths taken out, go to Google.${keyNote}`
      : 'Translating with the model from now on.'

  return setOption($, 'engine', engine, done)
}

// ─── Hooks ─────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const defaults: Settings = {
    enabled: options.enabled !== false,
    language: languageName(text(options.language) !== '' ? text(options.language) : 'English'),
  }
  const setup: Setup = {
    engine: text(options.engine) === 'google' ? 'google' : 'model',
    model: text(options.model),
    googleKey: text(options.googleApiKey),
  }
  const cache: Cache = new Map()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description:
        'Translate your prompts before they are sent: "/translate off", "/translate on", "/translate <language>", "/translate model <name>" or "/translate engine google|model"',
      argumentHint: '[on | off | <language> | model <name> | engine google|model]',
    })
    showStatus($, await current($, defaults), setup.engine)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const command = parse(e.args)
    const before = await current($, defaults)
    switch (command.kind) {
      case 'model':
        return { text: await modelCommand($, command.name, setup.model) }
      case 'engine':
        return { text: await engineCommand($, command.name, setup) }
      case 'status':
        break
      case 'on':
      case 'off':
      case 'toggle':
        await save(
          $,
          { ...before, enabled: command.kind === 'toggle' ? !before.enabled : command.kind === 'on' },
          setup.engine,
        )
        break
      case 'language':
        await save($, { enabled: true, language: command.name }, setup.engine)
        break
    }
    await update($, isCollapsed, () => false)
    const after = await current($, defaults)

    return {
      text: after.enabled
        ? `Translation is on: prompts are sent to the model in ${after.language}, translated by ${ENGINE_NAMES[setup.engine]}.`
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
    const result = await translate($, e.text, s.language, setup, cache)
    await update($, isTranslating, () => false)
    showStatus($, s, setup.engine)
    // Kept as the person reads it, the host's blocks left out.
    await update($, last, () => ({ ...result, original: typed, sent: visible(result.sent), language: s.language }))
    await update($, isCollapsed, () => false)
    if (result.outcome === 'failed') {
      $.ui.toast(`Translation failed (${oneLine(result.reason ?? 'unknown', 120)}); sent your original text.`)
    } else if (result.notice !== undefined) {
      $.ui.toast(oneLine(result.notice, 160))
    }

    return next(result.outcome === 'translated' ? { ...e, text: result.sent } : e)
  }).catch(async ($, e, next) => {
    // Whatever failed, the prompt still goes: as translated if it got that far,
    // else as typed.
    await update($, isTranslating, () => false)

    return next(e)
  })

  // A band above the prompt: that translation is on, into which language and
  // by what, and the last prompt as typed beside what the model received.
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
          <Box flexDirection="row" columnGap="sm">
            <Text color="suggestion" bold>
              ⇄ Translating into {s.language}
            </Text>
            {setup.engine === 'google' ? <Text color="subtle">via Google</Text> : null}
          </Box>
          <Box flexDirection="row" columnGap="sm">
            {shown === null ? null : isOpen ? (
              <Button key="collapse" label="Hide" plain dimColor onPress={() => update($, isCollapsed, () => true)} />
            ) : (
              <Button key="expand" label="Show last" plain dimColor onPress={() => update($, isCollapsed, () => false)} />
            )}
            <Button key="off" label="Turn off" plain dimColor onPress={() => save($, { ...s, enabled: false }, setup.engine)} />
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
            {shown.notice !== undefined ? <Text color="warning">⚠ {oneLine(shown.notice, width + LABEL_COLUMNS)}</Text> : null}
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
