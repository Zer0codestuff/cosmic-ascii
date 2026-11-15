import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { SCENE } from './scene'

// Total darkness: every surface is #000000, so an OLED panel keeps its pixels
// off everywhere the solar system is not drawn. One mode only.
const { theme, problems } = makeColors({
  label: 'Cosmic ASCII',
  only: 'dark',
  roles: { accent: '#e6e6e6', danger: '#ff5a3c', success: '#3cdc78', warning: '#ffa53a', pro: '#8ea8ff' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#000000',
        'surface-1': '#000000',
        'surface-2': '#000000',
        'surface-3': '#000000',
        'text-primary': '#ffffff',
        'text-secondary': '#bdbdbd',
        'text-muted': '#9a9a9a',
      },
    },
  },
})

const COMMAND = 'cosmic'
const SCENE_NAME = 'solar-system'

const LOOK: ThemeSetArgs = {
  colors: theme,
  // Panels stay black and unblurred over the scene.
  backdrop: { scene: SCENE_NAME, glass: { blur: 0, tint: '#000000', opacity: 0.55 } },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }

    try {
      await $.command.register({
        name: COMMAND,
        description: 'The Cosmic ASCII theme: alone it applies the theme, "off" clears it',
      })
    } catch (error) {
      $.ui.toast(`cosmic-ascii: /${COMMAND} is not available (${String(error)})`)
    }

    const set = await $.theme.set(LOOK)

    if (!set.isDrawn) {
      $.ui.status(set.reason)
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'off') {
      // The person asked: this clears whichever theme stands.
      await $.theme.clear()

      return { text: 'Theme cleared. /cosmic brings Cosmic ASCII back.' }
    }

    const set = await $.theme.set(LOOK)

    return { text: set.isDrawn ? 'Cosmic ASCII applied.' : `Cosmic ASCII applied, but nothing draws it here: ${set.reason}` }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    // Older desktop builds hand the scene's name over as `id`.
    const props = e.props as { scene?: unknown; id?: unknown }
    const name = typeof props.scene === 'string' ? props.scene : props.id

    if (name !== SCENE_NAME || (e.surface !== 'desktop' && e.surface !== 'mobile')) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)

    // The desktop app freezes the whole scene when it holds a viewport media
    // query, a CSS mask-image or vector-effect (measured in the app);
    // tools/build-scene.mjs refuses all three.
    return (
      <Svg
        source={SCENE}
        alt="An ASCII solar system: the Sun and nine worlds orbiting at speeds in their real order, lit by the Sun"
        isInteractive
      />
    )
  })
}
