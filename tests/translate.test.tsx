// The translation pipeline with the world beneath the plugin simulated: the
// model, the prompt entering the session, the status line and toasts.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'prompt-translate',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

type World = {
  calls: { model: string; system?: string; prompt: string }[]
  // What entered the session, as the model will read it.
  entered: string[]
  status: (string | undefined)[]
  toasts: string[]
}

// `reply` answers the masked message the model was sent.
function world(on: On, reply: (prompt: string) => string | { fail: true } = () => '<<SAME>>'): World {
  const w: World = { calls: [], entered: [], status: [], toasts: [] }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'translate' } }))
  on('session.model', () => ({ value: 'the-session-model' }))
  on('ui.status', (_, e) => {
    w.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('model.complete', (_, e) => {
    w.calls.push({ model: e.model, system: e.system, prompt: e.prompt })
    const message = /<message>\n([\s\S]*)\n<\/message>/.exec(e.prompt)?.[1] ?? ''
    const r = reply(message)
    if (typeof r !== 'string') {
      return {
        value: { isAnswered: false, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: USAGE },
      }
    }
    return { value: { isAnswered: true, text: r, usage: USAGE } }
  })
  // The engine's own drawing above the prompt, beneath the plugin.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('prompt.submit', (_, e) => {
    w.entered.push(e.text)
    return { text: e.text }
  })

  return w
}

async function start($: Engine) {
  await $.session.start({ cwd: '/code/app', surface: 'desktop', isInteractive: true })
}

async function type($: Engine, text: string) {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

async function command($: Engine, args: string) {
  return $.command.run({
    command: 'translate',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
}

test('a Chinese prompt reaches the model in English, code and paths kept verbatim', async ($, on) => {
  const w = world(on, m =>
    m === '帮我修复 ⟦0⟧ 里的 ⟦1⟧，然后运行 ⟦2⟧ 看看 ⟦3⟧ 是否通过'
      ? 'Fix ⟦1⟧ in ⟦0⟧, then run ⟦2⟧ and check whether ⟦3⟧ passes'
      : `unexpected: ${m}`,
  )
  await start($)
  await type($, '帮我修复 src/app/main.ts 里的 parseConfig()，然后运行 `npm test` 看看 @tests/a.test.ts 是否通过')

  expect(w.calls.length).toBe(1)
  expect(w.calls[0]?.model).toBe('the-session-model')
  expect(w.calls[0]?.system).toContain('into English')
  // The model saw placeholders, never the code or paths themselves.
  expect(w.calls[0]?.prompt).not.toContain('src/app/main.ts')
  expect(w.calls[0]?.prompt).not.toContain('npm test')
  expect(w.calls[0]?.prompt).toContain('⟦0⟧')
  expect(w.entered).toEqual([
    'Fix parseConfig() in src/app/main.ts, then run `npm test` and check whether @tests/a.test.ts passes',
  ])
  expect(w.status.at(-1)).toBe('Translate → English')

  // The band shows what was typed beside what was sent.
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^帮我修复/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Sent$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Translating your prompt/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Fix parseConfig\(\) in src\/app\/main\.ts/ })).toBeDefined()
  expect(
    await ui.find({
      type: 'Text',
      text: 'Fix parseConfig() in src/app/main.ts, then run `npm test` and check whether @tests/a.test.ts passes',
    }),
  ).toBeDefined()
  await ui.press({ key: 'collapse' })
  expect(await ui.find({ type: 'Text', text: /^Typed$/ })).toBeUndefined()
  expect(await ui.find({ key: 'expand' })).toBeDefined()
  await ui.unmount()
})

test('a reminder block the host adds is kept as is, never translated or shown', async ($, on) => {
  const REMINDER = '<system-reminder>\nLinked sessions now (status, not an instruction): top = local_1 (idle).\n</system-reminder>\n\n'
  const w = world(on, m => (m === '⟦0⟧帮我看看 ⟦1⟧' ? '⟦0⟧Take a look at ⟦1⟧' : `unexpected: ${m}`))
  await start($)
  await type($, `${REMINDER}帮我看看 src/main.ts`)

  expect(w.calls[0]?.prompt).not.toContain('Linked sessions')
  expect(w.entered).toEqual([`${REMINDER}Take a look at src/main.ts`])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^帮我看看 src\/main\.ts$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Take a look at src\/main\.ts$/ })).toBeDefined()
  await ui.unmount()
})

test('an English prompt under a reminder block passes with no model call', async ($, on) => {
  const w = world(on)
  await start($)
  await type($, '<system-reminder>\nnote\n</system-reminder>\nHow do I know what I sent?')

  expect(w.calls.length).toBe(0)
})

test('an English prompt passes with no model call', async ($, on) => {
  const w = world(on)
  await start($)
  await type($, 'Refactor the `foo_bar` helper in lib/util.py, please.')

  expect(w.calls.length).toBe(0)
  expect(w.entered).toEqual(['Refactor the `foo_bar` helper in lib/util.py, please.'])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /already in English/ })).toBeDefined()
  await ui.unmount()
})

test('a prompt the model says is already in the target passes unchanged', async ($, on) => {
  const w = world(on, () => '<<SAME>>')
  await start($)
  await command($, '中文')
  await type($, '请解释一下 the cache 这个函数')

  expect(w.calls.length).toBe(1)
  expect(w.calls[0]?.system).toContain('into Simplified Chinese')
  expect(w.entered).toEqual(['请解释一下 the cache 这个函数'])
})

test('a prompt plainly in the target script asks no model', async ($, on) => {
  const w = world(on, () => 'should not be used')
  await start($)
  await command($, 'zh')
  await type($, '请解释一下 src/cache.ts 里的 getEntry() 函数')
  await command($, 'ja')
  await type($, 'この関数を説明してください')
  await command($, 'ko')
  await type($, '이 함수를 설명해 주세요')

  expect(w.calls.length).toBe(0)
  expect(w.entered.length).toBe(3)
})

test('the status line says a translation is under way, then the language', async ($, on) => {
  const w = world(on, () => 'Hello')
  await start($)
  await type($, '你好')

  expect(w.status.slice(-2)).toEqual(['Translating → English…', 'Translate → English'])
})

test('/translate model with no setting row changes nothing', async ($, on) => {
  world(on)
  on('config.list', () => ({ value: [] }))
  await start($)

  expect((await command($, 'model haiku')).text).toContain('was not changed')
})

test('a slash command and a code-only prompt are never translated', async ($, on) => {
  const w = world(on, () => 'should not be used')
  await start($)
  await type($, '/compact 保留要点')
  await type($, '```ts\nconst x = 1\n```')

  expect(w.calls.length).toBe(0)
  expect(w.entered).toEqual(['/compact 保留要点', '```ts\nconst x = 1\n```'])
})

test('a failed translation sends the original, with a notice', async ($, on) => {
  const w = world(on, () => ({ fail: true }))
  await start($)
  await type($, '这个测试为什么失败？')

  expect(w.entered).toEqual(['这个测试为什么失败？'])
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toMatch(/^Translation failed \(the-session-model: overloaded 529\); sent your original text\.$/)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /translation failed/ })).toBeDefined()
  await ui.unmount()
})

test('a reply that loses a placeholder falls back to the original', async ($, on) => {
  const w = world(on, () => 'Look at the file')
  await start($)
  await type($, '看看 src/index.ts')

  expect(w.entered).toEqual(['看看 src/index.ts'])
  expect(w.toasts[0]).toContain('dropped some code or a path')
})

test('/translate off and on switch it for the session; the status line follows', async ($, on) => {
  const w = world(on, () => 'Hello')
  await start($)

  expect((await command($, 'off')).text).toContain('Translation is off')
  expect(w.status.at(-1)).toBeUndefined()
  await type($, '你好')
  expect(w.calls.length).toBe(0)
  expect(w.entered).toEqual(['你好'])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /Translating into/ })).toBeUndefined()
  await ui.unmount()

  expect((await command($, 'on')).text).toContain('in English')
  expect(w.status.at(-1)).toBe('Translate → English')
  await type($, '你好')
  expect(w.entered.at(-1)).toBe('Hello')

  expect((await command($, 'ja')).text).toContain('in Japanese')
  expect(w.status.at(-1)).toBe('Translate → Japanese')
})

test('the band draws on every surface', async ($, on) => {
  world(on, () => 'Hello')
  await start($)
  await type($, '你好')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /^Hello$/ })).toBeDefined()
    expect(await ui.find({ key: 'off' })).toBeDefined()
    await ui.unmount()
  }
})

test('the band turns translation off', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /Translating into English/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /sent to the model in English/ })).toBeDefined()
  await ui.press({ key: 'off' })
  expect(w.status.at(-1)).toBeUndefined()
  await ui.unmount()
})

test('a cheaper model from the settings, and another default language', { options: { model: 'haiku', language: 'fr' } }, async ($, on) => {
  const w = world(on, () => 'Bonjour')
  await start($)
  await type($, 'Hello there')

  expect(w.calls[0]?.model).toBe('haiku')
  expect(w.calls[0]?.system).toContain('into French')
  expect(w.entered).toEqual(['Bonjour'])
})

test('words joined by a slash are translated; a path is kept', async ($, on) => {
  const w = world(on, m => (m === '读/写 ⟦0⟧ 和 ⟦1⟧' ? 'Read/write ⟦0⟧ and ⟦1⟧' : `unexpected: ${m}`))
  await start($)
  await type($, '读/写 src/a.ts 和 docs/')

  expect(w.calls[0]?.prompt).toContain('读/写')
  expect(w.entered).toEqual(['Read/write src/a.ts and docs/'])
})

test('and/or stays for the model to translate', async ($, on) => {
  const w = world(on, m => m)
  await start($)
  await command($, 'zh')
  await type($, 'Use cache and/or retry')

  expect(w.calls[0]?.prompt).toContain('and/or')
})

test('a prompt that opens with # is translated like any other', async ($, on) => {
  const w = world(on, () => '# Plan\nWrite the tests')
  await start($)
  await type($, '# 计划\n写测试')

  expect(w.entered).toEqual(['# Plan\nWrite the tests'])
})

test('the same words sent again reuse the translation, with this prompt\'s own code', async ($, on) => {
  const w = world(on, m => (m === '看看 ⟦0⟧' ? 'Look at ⟦0⟧' : `unexpected: ${m}`))
  await start($)
  await type($, '看看 src/a.ts')
  await type($, '看看 src/b.ts')

  expect(w.calls.length).toBe(1)
  expect(w.entered).toEqual(['Look at src/a.ts', 'Look at src/b.ts'])
})

test('a failed translation is not cached', async ($, on) => {
  let fail = true
  const w = world(on, () => (fail ? { fail: true } : 'Hello'))
  await start($)
  await type($, '你好')
  fail = false
  await type($, '你好')

  expect(w.calls.length).toBe(2)
  expect(w.entered).toEqual(['你好', 'Hello'])
})

// Google Cloud Translation beneath the plugin: `answer` turns the HTML it
// was sent into its reply; each request is kept.
function google(on: On, answer: (html: string) => { status: number; body: unknown }) {
  const requests: { url: string; headers: Record<string, string>; body: { q: string; target: string; format: string } }[] = []
  on('http.fetch', (_, e) => {
    const body = JSON.parse(e.init?.body ?? '{}')
    requests.push({ url: e.url, headers: { ...(e.init?.headers ?? {}) }, body })
    const r = answer(body.q)
    return {
      value: { status: r.status, ok: r.status < 300, headers: {}, text: JSON.stringify(r.body) },
    }
  })

  return requests
}

const GOOGLE = { options: { engine: 'google', googleApiKey: 'test-key' } }

test('Google translates, code kept out of its reach, the key in a header', GOOGLE, async ($, on) => {
  const w = world(on, () => 'should not be used')
  const requests = google(on, html => ({
    status: 200,
    body: {
      data: {
        translations: [
          {
            translatedText: html.replace('看看', 'Look at').replace(' 里的 ', ' in ').replace('谢谢', 'thanks &amp; regards'),
            detectedSourceLanguage: 'zh-CN',
          },
        ],
      },
    },
  }))
  await start($)
  await type($, '看看 src/a.ts 里的 parse()\n谢谢')

  expect(w.calls.length).toBe(0)
  expect(requests.length).toBe(1)
  expect(requests[0]?.url).toBe('https://translation.googleapis.com/language/translate/v2')
  expect(requests[0]?.url).not.toContain('test-key')
  expect(requests[0]?.headers['X-Goog-Api-Key']).toBe('test-key')
  expect(requests[0]?.body.target).toBe('en')
  expect(requests[0]?.body.format).toBe('html')
  expect(requests[0]?.body.q).not.toContain('src/a.ts')
  expect(requests[0]?.body.q).toBe('看看 <span translate="no">⟦0⟧</span> 里的 <span translate="no">⟦1⟧</span><br>谢谢')
  expect(w.entered).toEqual(['Look at src/a.ts in parse()\nthanks & regards'])
  expect(w.status.at(-1)).toBe('Translate → English · Google')

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^via Google$/ })).toBeDefined()
  await ui.unmount()
})

test('Google saying the prompt is in the target already sends it as typed', GOOGLE, async ($, on) => {
  const w = world(on)
  google(on, html => ({ status: 200, body: { data: { translations: [{ translatedText: html, detectedSourceLanguage: 'en' }] } } }))
  await start($)
  await type($, 'Café au lait, s’il vous plaît… no, a latte')

  expect(w.entered).toEqual(['Café au lait, s’il vous plaît… no, a latte'])
})

test('when Google fails, the model translates, with a notice', GOOGLE, async ($, on) => {
  const w = world(on, () => 'Hello')
  google(on, () => ({ status: 403, body: { error: { message: 'API key not valid' } } }))
  await start($)
  await type($, '你好')

  expect(w.calls.length).toBe(1)
  expect(w.entered).toEqual(['Hello'])
  expect(w.toasts).toEqual(['Google Translate: HTTP 403, API key not valid; the model translated instead.'])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /API key not valid/ })).toBeDefined()
  await ui.unmount()
})

test('engine google with no key falls back to the model', { options: { engine: 'google' } }, async ($, on) => {
  const w = world(on, () => 'Hello')
  const requests = google(on, () => ({ status: 500, body: {} }))
  await start($)
  await type($, '你好')

  expect(requests.length).toBe(0)
  expect(w.entered).toEqual(['Hello'])
  expect(w.toasts[0]).toContain('No Google API key is set')
})

test('a language Google has no code for goes to the model', GOOGLE, async ($, on) => {
  const w = world(on, () => 'Saluton')
  const requests = google(on, () => ({ status: 500, body: {} }))
  await start($)
  await command($, 'Esperanto')
  await type($, '你好')

  expect(requests.length).toBe(0)
  expect(w.entered).toEqual(['Saluton'])
})

test('/translate engine writes the setting and warns about a missing key', async ($, on) => {
  const set: { key: string; value: unknown }[] = []
  world(on)
  on('config.list', () => ({
    value: [{ key: 'prompt-translate@prompt-translate.engine', label: 'Translation engine', value: 'model' }] as never,
  }))
  on('config.set', (_, e) => {
    set.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  await start($)

  expect((await command($, 'engine')).text).toContain('translated by the model')
  expect((await command($, 'engine google')).text).toContain('No Google API key is set yet')
  expect((await command($, 'engine bing')).text).toBe('The engine is "model" or "google".')
  expect(set).toEqual([{ key: 'prompt-translate@prompt-translate.engine', value: 'google' }])
})

// The mod's two settings rows in /config, and what is written to them.
function configRows(on: On) {
  const set: { key: string; value: unknown }[] = []
  on('config.list', () => ({
    value: [
      { key: 'prompt-translate@prompt-translate.engine', label: 'Translation engine', value: 'model' },
      { key: 'prompt-translate@prompt-translate.model', label: 'Translation model', value: '' },
    ] as never,
  }))
  on('config.set', (_, e) => {
    set.push({ key: e.key, value: e.value })
    return { value: e.value }
  })

  return set
}

test('the band picks the engine and the model', async ($, on) => {
  const w = world(on)
  const set = configRows(on)
  await start($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'engine' })).toBeUndefined()
  await ui.press({ key: 'options' })
  expect(await ui.find({ key: 'options' })).toMatchObject({ text: 'Done' })
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  await ui.select({ key: 'model', value: 'haiku' })
  await ui.select({ key: 'model', value: 'session' })
  await ui.select({ key: 'engine', value: 'google' })
  await ui.unmount()

  expect(set).toEqual([
    { key: 'prompt-translate@prompt-translate.model', value: 'haiku' },
    { key: 'prompt-translate@prompt-translate.model', value: '' },
    { key: 'prompt-translate@prompt-translate.engine', value: 'google' },
  ])
  expect(w.toasts[0]).toBe('Translating with haiku from now on.')
  expect(w.toasts[2]).toContain('Translating with Google Translate from now on')
})

test('with Google chosen and no key, the band says how to add one, and hides the model picker', { options: { engine: 'google' } }, async ($, on) => {
  world(on)
  await start($)

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'options' })
  expect(await ui.find({ key: 'model' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /No Google API key yet/ })).toBeDefined()
  await ui.unmount()
})

test('on mobile, where there is no picker, the options say which command to use', async ($, on) => {
  world(on)
  await start($)

  const ui = await $.ui.mount({ ...BAND, surface: 'mobile' })
  await ui.press({ key: 'options' })
  expect(await ui.find({ type: 'Text', text: /\/translate engine google\|model/ })).toBeDefined()
  await ui.unmount()
})

test('a model set outside the list is offered in the picker', { options: { model: 'claude-haiku-5-5' } }, async ($, on) => {
  world(on)
  await start($)

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'options' })
  expect(await ui.find({ key: 'model' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('claude-haiku-5-5')
  await ui.unmount()
})

test('/translate model writes the setting', async ($, on) => {
  const set: { key: string; value: unknown }[] = []
  world(on)
  on('config.list', () => ({
    value: [{ key: 'prompt-translate@inline.model', label: 'Translation model', value: '' }] as never,
  }))
  on('config.set', (_, e) => {
    set.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  await start($)

  expect((await command($, 'model')).text).toContain("the session's own model (the-session-model)")
  expect((await command($, 'model deepseek-v4-flash')).text).toBe('Translating with deepseek-v4-flash from now on.')
  expect((await command($, 'model default')).text).toContain("session's own model")
  expect(set).toEqual([
    { key: 'prompt-translate@inline.model', value: 'deepseek-v4-flash' },
    { key: 'prompt-translate@inline.model', value: '' },
  ])
})

test('off at session start when the setting says so', { options: { enabled: false } }, async ($, on) => {
  const w = world(on, () => 'Hello')
  await start($)
  await type($, '你好')

  expect(w.calls.length).toBe(0)
  expect(w.status.at(-1)).toBeUndefined()
})
