JavaScript GLOV.js framework
============================

**Demos**
* General feature test: [glovjs-playground](http://jimbly.github.io/glovjs/playground/)
* Terminal module test: [glovjs-terminal](http://jimbly.github.io/glovjs/terminal/)

**Projects using this framework**
* [Worlds FRVR](https://worlds.frvr.com/)
* [Most of my Ludum Dare entries](http://www.dashingstrike.com/games.html#ld)

**Notes**
* Files can be ES2020 (through Babel)
* Server automatically restarts on any relevant file change
* Client automatically reloads on javascript or html change
* Client automatically dynamically reloads CSS, texture, etc file changes
* Client .js and vendor files all bundled and minified
* Source maps created for debugging, even on minified builds
* Limited static-fs supported for embedding non-.js files into source, glov/webfs preferred to get dynamic reloads
* Much functionality derived from libGlov (open source C/C++ games framework)

Useful SublimeText 3 packages
* SublimeLinter
* SublimeLinter-eslint (requires `npm i -g eslint`)

Start with: `npm start` (after running `npm i` once)

Build distributable files with: `npm run-script build`

Feature demo is index.html (`main.js`), multiplayer demo (requires server) is the built index_multiplayer.html (references `multiplayer.js`)

Notes:
* The engine API (glov/*) is subject to change occasionally, it often changes with each Ludum Dare in which I use this engine ^_^, though it's been fairly stable for the last couple years.
* To use MP3 audio files, convert all .wav to .mp3 at the end of development, call engine.startup with `{ sound: { ext_list: ['mp3', 'wav'] } }`
* Before publishing a project, edit the meta tags in index.html, place a 1200x630px cover image for use on Facebook and Twitter shares.

