// Translation for this session: on or off, and the language prompts are sent in.
export type Settings = { enabled: boolean; language: string }

// The last prompt typed, and what was actually sent to the model.
export type Last = {
  original: string
  sent: string
  language: string
  // translated: sent in `language`; same: already in it, sent as typed;
  // failed: the translation failed, sent as typed.
  outcome: 'translated' | 'same' | 'failed'
  reason?: string
  // Which engine translated it, when one did.
  engine?: Engine
  // Said beside the result: Google failed, and the model translated instead.
  notice?: string
}

// What translates: the Claude Code model, or Google Cloud Translation.
export type Engine = 'model' | 'google'

declare module 'claude-code' {
  interface PluginState {
    'prompt-translate': {
      settings: Shaped<Settings | null>
      last: Shaped<Last | null>
      isCollapsed: boolean
      // Whether the band's engine and model pickers are open.
      isOptionsOpen: boolean
      // True while a prompt waits on its translation.
      isTranslating: boolean
    }
  }
}
