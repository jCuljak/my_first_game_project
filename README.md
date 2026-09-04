# My First Game

A browser game built with plain HTML, CSS and JavaScript — no build step, no dependencies.

## Play it

https://jculjak.github.io/my_first_game_project/

Works on desktop and phones — the same link adapts to whichever device opens it.

## Running it locally

Open `index.html` in your browser. That's it.

If you'd rather serve it over `http://` (needed later if we start loading
JSON, modules or audio files, which browsers block on `file://`):

```bash
npx serve .
```

## Layout

```
index.html      page shell, canvas element, touch controls
css/style.css   styling, responsive layout
js/game.js      game loop, input, rendering
js/audio.js     synthesised music and sound effects
assets/         images and sounds
```

## Controls

| | Desktop | Phone |
|---|---|---|
| Move | Arrow keys / WASD | Drag the joystick |
| Dash | Shift | Tap DASH |
| Pause | Esc | Tap II |
| Restart | R | Tap the screen |
| Mute | M | — |

## License

All rights reserved — see [LICENSE](LICENSE).

## Repository

https://github.com/jCuljak/my_first_game_project

To clone it somewhere else:

```bash
git clone https://github.com/jCuljak/my_first_game_project.git
```
