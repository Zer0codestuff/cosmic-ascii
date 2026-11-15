# Cosmic ASCII

A theme for the Claude Code desktop and mobile apps. Every surface is pure
black, so an OLED screen keeps its pixels off, and behind the conversation an
ASCII solar system turns: the Sun with slowly boiling granulation, Earth and
Mars spinning, each world shaded from the Sun with moving phases, an asteroid
belt, dotted orbits and a field of stars.

Planets keep their real order of speed, compressed so the outer worlds still
visibly move: a period of 40 s times the square root of the real one in years
(Mercury about 20 s, Earth 40 s, Neptune about 8.5 min).

The terminal and editor extensions do not draw themes.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install cosmic-ascii --marketplace Zer0codestuff/cosmic-ascii
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in
every session).

From a shell:

```sh
claude plugin install cosmic-ascii --marketplace Zer0codestuff/cosmic-ascii
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `Zer0codestuff/cosmic-ascii`, then Add
plugin.

## Use

The theme applies itself when a session starts. `/cosmic` applies it again
(for example after another theme replaced it) and `/cosmic off` clears it.

With Reduce Motion turned on in your system settings, the desktop app keeps
every backdrop still.

## Rebuild the scene

```sh
node tools/build-scene.mjs [preview-dir]
```

This rewrites `hooks/scene.ts`, prints each body's size and refuses a scene
over 131,072 characters or one holding features that freeze backdrops in the
desktop app (viewport media queries, CSS `mask-image`, `vector-effect`).

## License

MIT, see `LICENSE`. `hooks/make-colors.js` and `hooks/make-colors.d.ts` are
copied unchanged from Claude Code's plugin-authoring skill.
