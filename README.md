# My First Game

A browser game built with plain HTML, CSS and JavaScript — no build step, no dependencies.

## Running it

Open `index.html` in your browser. That's it.

If you'd rather serve it over `http://` (needed later if we start loading
JSON, modules or audio files, which browsers block on `file://`):

```bash
npx serve .
```

## Layout

```
index.html      page shell and canvas element
css/style.css   styling
js/game.js      game loop, input, rendering
assets/         images and sounds
```

## Controls

Arrow keys or WASD to move.

## Repository

https://github.com/jCuljak/my_first_game_project

To clone it somewhere else:

```bash
git clone https://github.com/jCuljak/my_first_game_project.git
```
