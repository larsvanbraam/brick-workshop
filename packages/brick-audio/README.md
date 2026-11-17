# Brick audio

Music and voices, made in the browser: no sound files ship, and the package has no dependencies.

Import by module, e.g. `import { AmbientMusic } from '@brick-workshop/audio/music'`.

| Module     | What it does                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `music`    | `AmbientMusic`: a soft, felt-like piano synthesised note by note, in a large reverb.                                   |
| `composer` | `Composer`: writes an endless slow piece a few seconds ahead of where it is played. It knows nothing about audio.      |
| `voice`    | `Voices`: the people's voices, either Simlish-like babble synthesised syllable by syllable or the device's own speech. |

## Music

`Composer` hands out notes with the time they start, and `AmbientMusic` plays them. The piece is
a string of sections, each a minute or two long: a four-chord progression in one key with one
texture (sparse chords, a wandering melody, rippling broken chords or high bells). Between
sections the progression, texture and tempo change, now and then the key (always a fifth away, so most notes are
shared). The melody keeps to the key's pentatonic scale, which fits every chord, so nothing clashes.

Browsers only start audio after the page is clicked or a key pressed, so call `start` from a click
or key handler. The music pauses on its own while the tab is hidden and while the volume is 0.

## Voices

`voiceFor(seed, register?)` gives someone a voice (low or high, quick or slow) from their seed, so the same person always sounds the same. `Voices` speaks it either as babble or through the device's own speech, matched to the same traits. Like the music, speaking must start from a click or key handler.

## Tests

```sh
pnpm test    # from the repository root
```
