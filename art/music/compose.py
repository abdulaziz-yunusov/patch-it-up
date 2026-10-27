"""Original music for Patch It Up, written as MIDI and rendered with FluidR3_GM.

Three loops and two stingers:
  harbour  calm 6/8 sea tune for the menu, the dock and the result screen
  underway steady, adventurous flight music
  storm    epic action: storm walls, pirates, fires, a ship losing height
  down     going down (3 s ending + tail)
  home     harbour in sight (4 s ending + tail)

Loops are rendered with their reverb tail folded back onto the start, so
they repeat without a seam.
"""

import random
import subprocess
import sys
from pathlib import Path

import numpy as np
import pretty_midi
import soundfile as sf

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SF2 = '/usr/share/sounds/sf2/FluidR3_GM.sf2'
SR = 44100
random.seed(7)

NAMES = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11}


def pitch(name):
    """'D4' -> 62, 'Bb3' -> 58, 'F#5' -> 78."""
    letters = name.rstrip('0123456789-')
    octave = int(name[len(letters):])
    return 12 * (octave + 1) + NAMES[letters]


def chord(name):
    """'Dm' -> (2, minor third), 'Bb' -> (10, major third)."""
    minor = name.endswith('m')
    root = NAMES[name[:-1] if minor else name]
    return root, 3 if minor else 4


def place(pc, low, high):
    """The pitch of class pc within [low, high)."""
    p = low + (pc - low) % 12
    return p if p < high else p - 12


class Song:
    def __init__(self, unit):
        self.unit = unit  # seconds per grid step
        self.midi = pretty_midi.PrettyMIDI(initial_tempo=120)
        self.parts = {}

    def part(self, key, program, drum=False):
        if key not in self.parts:
            inst = pretty_midi.Instrument(program=program, is_drum=drum, name=key)
            self.midi.instruments.append(inst)
            self.parts[key] = inst
        return self.parts[key]

    def note(self, key, program, p, at, dur, vel, drum=False, loose=0.006):
        inst = self.part(key, program, drum)
        start = max(0.0, at * self.unit + (random.uniform(-loose, loose) if at > 0 else 0))
        end = start + max(0.03, dur * self.unit)
        vel = int(max(1, min(127, vel + random.randint(-4, 4))))
        inst.notes.append(pretty_midi.Note(velocity=vel, pitch=int(p), start=start, end=end))

    def cc(self, key, program, number, value, at):
        self.part(key, program).control_changes.append(pretty_midi.ControlChange(number, value, at * self.unit))

    def melody(self, key, program, tune, at, vel, shift=0, legato=0.95):
        """tune: [(pitch name or None, length in units)]."""
        t = at
        for name, length in tune:
            if name:
                self.note(key, program, pitch(name) + shift, t, length * legato, vel + (6 if t == at else 0))
            t += length
        return t


def render(song, name, length, loop):
    mid = OUT / f'{name}.mid'
    wav = OUT / f'{name}.raw.wav'
    # A silent event well past the end, so the synth renders the whole tail.
    song.cc('tail', 0, 7, 0, (length + 6.0) / song.unit)
    song.midi.write(str(mid))
    subprocess.run(
        ['fluidsynth', '-ni', '-q', '-g', '0.5', '-r', str(SR), '-R', '1', '-C', '1', '-F', str(wav), SF2, str(mid)],
        check=True,
    )
    y, sr = sf.read(wav, always_2d=True)
    n = int(round(length * SR))
    if loop:
        body = y[:n].copy()
        tail = y[n:]
        body[: len(tail)] += tail[: len(body)]
        y = body
    else:
        # keep the ring-out, trimmed where it falls silent
        loud = np.where(np.abs(y).max(axis=1) > 2e-3)[0]
        y = y[: loud[-1] + 1] if len(loud) else y
        fade = min(len(y), int(0.25 * SR))
        y[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return y


def master(y, rms_db, peak=0.92):
    rms = np.sqrt(np.mean(y**2)) + 1e-12
    y = y * (10 ** (rms_db / 20) / rms)
    # Soft limit only the loudest peaks.
    over = np.abs(y) > peak
    if over.any():
        y = np.where(over, np.sign(y) * (peak + (1 - peak) * np.tanh((np.abs(y) - peak) / (1 - peak))), y)
    return y


# ---------------------------------------------------------------------------
# harbour: 6/8, dotted crotchet = 56. One unit = a quaver.

def harbour():
    s = Song(60 / 168)
    GUITAR, BASS, PAD, FLUTE, ACC, HARP, GLOCK = 24, 32, 49, 73, 21, 46, 9

    intro = ['G', 'Em', 'C', 'D']
    verse = ['G', 'Em', 'C', 'D', 'G', 'Em', ('Am', 'D'), 'G']
    bridge = ['C', 'G', 'Am', 'Em', 'C', 'G', 'Am', 'D']
    bars = intro + verse + verse + bridge + verse
    # A: the tune; A2: its answer; B: the bridge, on the accordion.
    A = [('B4', 2), ('C5', 1), ('D5', 3), ('E5', 2), ('D5', 1), ('B4', 3), ('C5', 2), ('B4', 1), ('A4', 2), ('G4', 1),
         ('A4', 5), (None, 1), ('B4', 2), ('C5', 1), ('D5', 2), ('G5', 1), ('E5', 3), ('D5', 2), ('B4', 1),
         ('C5', 2), ('B4', 1), ('A4', 2), ('F#4', 1), ('G4', 5), (None, 1)]
    A2 = [('D5', 2), ('E5', 1), ('D5', 2), ('B4', 1), ('G5', 3), ('E5', 3), ('E5', 2), ('D5', 1), ('C5', 2), ('A4', 1),
          ('D5', 2), ('C5', 1), ('A4', 3), ('B4', 2), ('D5', 1), ('G5', 3), ('F#5', 2), ('E5', 1), ('D5', 3),
          ('C5', 2), ('E5', 1), ('D5', 2), ('C5', 1), ('B4', 2), ('A4', 1), ('G4', 3)]
    B = [('G4', 2), ('C5', 1), ('E5', 3), ('D5', 2), ('B4', 1), ('G4', 3), ('A4', 2), ('C5', 1), ('E5', 2), ('D5', 1),
         ('B4', 5), (None, 1), ('G4', 2), ('C5', 1), ('E5', 2), ('G5', 1), ('D5', 3), ('B4', 2), ('D5', 1),
         ('C5', 2), ('B4', 1), ('A4', 2), ('C5', 1), ('A4', 5), (None, 1)]

    for bar, harmony in enumerate(bars):
        at = bar * 6
        halves = harmony if isinstance(harmony, tuple) else (harmony, harmony)
        for half, name in enumerate(halves):
            root, third = chord(name)
            g = place(root, 48, 60)
            arp = [g, g + 7, g + 12, g + 12 + third, g + 12, g + 7]
            for i in range(3):
                k = half * 3 + i
                s.note('guitar', GUITAR, arp[k], at + k, 2.6, 62 if k % 3 == 0 else 50)
            b = place(root, 40, 52)
            s.note('bass', BASS, b if half == 0 else (b + 7 if b + 7 < 55 else b - 5), at + half * 3, 2.8, 72 if half == 0 else 60)
        section = 0 if bar < 4 else 1 if bar < 12 else 2 if bar < 20 else 3 if bar < 28 else 4
        if section >= 2:
            root, third = chord(halves[0])
            r = place(root, 55, 67)
            for p in (r, r + third, r + 7):
                s.note('pad', PAD, p, at, 6, 36 if section == 2 else 44)
        if section == 3 and bar % 2 == 0:
            root, third = chord(halves[0])
            h = place(root, 60, 72)
            for i, p in enumerate([h, h + third, h + 7, h + 12, h + 12 + third, h + 19]):
                s.note('harp', HARP, p, at + i * 0.5, 3, 46)
    s.melody('flute', FLUTE, A, 4 * 6, 78)
    s.melody('flute', FLUTE, A2, 12 * 6, 82)
    s.melody('acc', ACC, B, 20 * 6, 70)
    s.melody('flute', FLUTE, A, 28 * 6, 80)
    s.melody('acc', ACC, A, 28 * 6, 46, shift=-12)
    # a few glockenspiel sparkles at the start of each phrase
    for bar in (4, 12, 28):
        s.note('glock', GLOCK, pitch('D6'), bar * 6, 2, 34)
        s.note('glock', GLOCK, pitch('G6'), bar * 6 + 3, 2, 30)
    length = len(bars) * 6 * s.unit
    return s, length


# ---------------------------------------------------------------------------
# underway: 4/4 at 112. One unit = a quaver.

def underway():
    s = Song(30 / 112)
    PIZZ, CELLO, STR, TIMP, HORN, CLAR, FLUTE = 45, 42, 48, 47, 60, 71, 73
    main = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A']
    turn = ['Bb', 'F', 'C', 'Dm', 'Bb', 'F', 'Gm', 'A']
    bars = main + main + turn + main
    horn = [('A4', 6), ('D5', 2), ('C5', 4), ('A4', 4), ('Bb4', 6), ('F4', 2), ('G4', 4), ('E4', 4),
            ('A4', 4), ('D5', 2), ('E5', 2), ('F5', 6), ('E5', 2), ('D5', 4), ('Bb4', 4), ('C#5', 4), ('A4', 4)]
    horn2 = horn[:-2] + [('C#5', 2), ('E5', 2), ('A5', 4)]
    clar = [('D5', 4), ('F5', 4), ('C5', 6), ('A4', 2), ('G4', 4), ('C5', 4), ('A4', 8),
            ('Bb4', 4), ('D5', 4), ('F5', 6), ('E5', 2), ('D5', 4), ('G5', 4), ('E5', 4), ('C#5', 4)]
    for bar, name in enumerate(bars):
        at = bar * 8
        section = bar // 8
        root, third = chord(name)
        r = place(root, 43, 55)
        figure = [r, r + 7, r + 12, r + 7, r, r + 7, r + 12, r + 12 + third]
        for i, p in enumerate(figure):
            s.note('pizz', PIZZ, p, at + i, 0.9, 82 if i % 2 == 0 else 64)
        s.note('cello', CELLO, place(root, 36, 48), at, 7.8, 66)
        if section >= 1:
            v = place(root, 57, 69)
            for p in (v, v + third, v + 7):
                s.note('strings', STR, p, at, 8, 46 if section != 2 else 54)
            s.note('timp', TIMP, place(root, 43, 55), at, 1, 74)
            s.note('timp', TIMP, place(root, 43, 55), at + 6, 1, 56)
        # light drums: soft kick on 1 and 3, shaker quavers
        s.note('drums', 0, 35, at, 1, 58, drum=True)
        s.note('drums', 0, 35, at + 4, 1, 50, drum=True)
        for i in range(8):
            s.note('drums', 0, 70, at + i, 0.5, 40 if i % 2 == 0 else 28, drum=True)
        if section >= 1 and bar % 8 == 7:
            for i in range(4):
                s.note('drums', 0, 38, at + 6 + i * 0.5, 0.4, 40 + i * 8, drum=True)
    s.melody('horn', HORN, horn, 8 * 8, 82)
    s.melody('clar', CLAR, clar, 16 * 8, 76)
    s.melody('horn', HORN, horn2, 24 * 8, 88)
    s.melody('flute', FLUTE, horn2, 24 * 8, 52, shift=12)
    length = len(bars) * 8 * s.unit
    return s, length


# ---------------------------------------------------------------------------
# storm: 4/4 at 144. One unit = a semiquaver.

def storm():
    s = Song(15 / 144)
    STR, CELLO, BASS, BRASS, HORN, TRUMPET, CHOIR, TIMP, TAIKO = 48, 42, 43, 61, 60, 56, 52, 47, 116
    prog = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A']
    bars = prog * 4
    tune = [('D5', 6), ('A4', 2), ('D5', 4), ('E5', 4), ('F5', 12), ('E5', 2), ('D5', 2), ('C5', 12), ('A4', 4),
            ('E5', 8), ('D5', 4), ('C5', 4), ('D5', 6), ('A4', 2), ('D5', 4), ('E5', 4), ('F5', 8), ('D5', 4), ('F5', 4),
            ('D5', 8), ('Bb4', 4), ('G4', 4), ('A4', 12), ('C#5', 2), ('E5', 2)]
    tune2 = tune[:-3] + [('A4', 4), ('C#5', 4), ('E5', 4), ('A5', 4)]
    for bar, name in enumerate(bars):
        at = bar * 16
        section = bar // 8
        root, third = chord(name)
        r = place(root, 45, 57)
        figure = [0, 0, 12, 0, 7, 0, 12, 0]
        for i in range(16):
            s.note('ostinato', STR, r + figure[i % 8], at + i, 0.8, 96 if i % 4 == 0 else 72, loose=0.003)
            if section >= 2:
                s.note('violins', STR, r + 12 + figure[i % 8], at + i, 0.8, 64 if i % 4 == 0 else 50, loose=0.003)
        low = place(root, 33, 45)
        s.note('bass', BASS, low, at, 15.8, 88)
        s.note('cello', CELLO, low + 12, at, 15.8, 72)
        if section >= 1:
            v = place(root, 53, 65)
            voicing = (v, v + third, v + 7)
            if section == 3:
                for start, length in ((0, 5), (6, 5), (12, 4)):
                    for p in voicing:
                        s.note('brass', BRASS, p, at + start, length, 100 if start == 0 else 88)
            else:
                for p in voicing:
                    s.note('brass', BRASS, p, at, 15.5, 78 if section == 1 else 86)
            s.note('timp', TIMP, place(root, 43, 55), at, 2, 104)
            s.note('timp', TIMP, place(root, 43, 55), at + 8, 2, 88)
        if section == 3:
            c = place(root, 60, 72)
            for p in (c, c + third, c + 7):
                s.note('choir', CHOIR, p, at, 15.5, 74)
        # taiko and drums
        for i, v in ((0, 112), (3, 82), (6, 96), (8, 112), (11, 82), (14, 92)):
            s.note('taiko', TAIKO, 48, at + i, 2, v)
        s.note('drums', 0, 36, at, 2, 96, drum=True)
        s.note('drums', 0, 36, at + 8, 2, 90, drum=True)
        if bar % 8 == 0:
            s.note('drums', 0, 49, at, 8, 96 if section else 80, drum=True)
        if section >= 2:
            s.note('drums', 0, 38, at + 4, 1, 78, drum=True)
            s.note('drums', 0, 38, at + 12, 1, 82, drum=True)
        if bar % 8 == 7 and bar != len(bars) - 1:
            for i in range(16):  # timpani roll into the next section
                s.note('timp', TIMP, place(chord('A')[0], 43, 55), at + 8 + i * 0.5, 0.5, 60 + i * 3, loose=0.002)
        if bar == len(bars) - 1:
            for i, tom in enumerate([50, 50, 48, 48, 47, 47, 45, 45, 43, 43, 41, 41]):
                s.note('drums', 0, tom, at + 4 + i, 1, 84 + i * 2, drum=True)
    s.melody('horn', HORN, tune, 16 * 16, 96)
    s.melody('trumpet', TRUMPET, tune2, 24 * 16, 92)
    s.melody('horn', HORN, tune2, 24 * 16, 84, shift=-12)
    length = len(bars) * 16 * s.unit
    return s, length


# ---------------------------------------------------------------------------
# stingers, written in seconds (unit = 1 s)

def down():
    s = Song(1.0)
    BRASS, TREM, TIMP, TUBA, TROMBONE, PIANO, CHOIR, TAIKO, STR = 61, 44, 47, 58, 57, 0, 52, 116, 48
    for p in ('D4', 'F4', 'A4'):
        s.note('brass', BRASS, pitch(p), 0, 0.5, 112)
    s.note('low', STR, pitch('D2'), 0, 2.6, 96)
    top = ['A4', 'G#4', 'G4', 'F#4', 'F4', 'E4', 'Eb4', 'D4']
    under = ['F4', 'E4', 'Eb4', 'D4', 'Db4', 'C4', 'B3', 'Bb3']
    for i, (a, b) in enumerate(zip(top, under)):
        at = 0.35 + i * 0.28
        s.note('trem', TREM, pitch(a), at, 0.3, 70 + i * 5)
        s.note('trem', TREM, pitch(b), at, 0.3, 66 + i * 5)
        s.note('brass', BRASS, pitch(a) - 12, at, 0.3, 64 + i * 6)
    for i in range(24):  # timpani roll, building
        s.note('timp', TIMP, pitch('D3'), 1.2 + i * 0.058, 0.06, 48 + i * 3, loose=0.002)
    hit = 2.6
    for p in ('D2', 'A2', 'D3', 'F3'):
        s.note('tuba', TUBA if p == 'D2' else TROMBONE, pitch(p), hit, 2.2, 118)
    for p in ('D1', 'A1', 'D2', 'Eb2'):
        s.note('piano', PIANO, pitch(p), hit, 2.5, 120)
    for p in ('D3', 'F3', 'A3'):
        s.note('choir', CHOIR, pitch(p), hit, 2.4, 92)
    s.note('timp', TIMP, pitch('D2') + 12, hit, 1, 127)
    s.note('taiko', TAIKO, 36, hit, 1, 127)
    s.note('drums', 0, 49, hit, 3, 124, drum=True)
    s.note('drums', 0, 57, hit, 3, 110, drum=True)
    s.note('drums', 0, 36, hit, 1, 127, drum=True)
    return s, 5.5


def home():
    s = Song(1.0)
    TRUMPET, HORN, TROMBONE, TUBA, TIMP, BELLS, STR, HARP = 56, 60, 57, 58, 47, 14, 48, 46
    for i, p in enumerate(['D4', 'F#4', 'A4', 'D5', 'F#5', 'A5', 'D6']):
        s.note('harp', HARP, pitch(p), i * 0.06, 2, 70)
    fanfare = [('A4', 0.0, 0.14), ('A4', 0.16, 0.14), ('A4', 0.32, 0.14), ('D5', 0.48, 0.5), ('A4', 1.0, 0.28),
               ('D5', 1.3, 0.28), ('F#5', 1.6, 0.4), ('E5', 2.02, 0.32)]
    for p, at, dur in fanfare:
        s.note('trumpet', TRUMPET, pitch(p), at, dur, 104)
        s.note('horn', HORN, pitch(p) - 12, at, dur, 80)
    for p in ('D4', 'F#4', 'A4'):
        s.note('strings', STR, pitch(p), 0.48, 1.9, 70)
    for i in range(14):
        s.note('timp', TIMP, pitch('A2') + 12, 1.6 + i * 0.055, 0.06, 56 + i * 4, loose=0.002)
    final = 2.4
    for p in ('D5', 'F#5', 'A5'):
        s.note('trumpet', TRUMPET, pitch(p), final, 2.4, 112)
    for p in ('D4', 'A4'):
        s.note('horn', HORN, pitch(p), final, 2.6, 100)
    for p in ('D3', 'A3'):
        s.note('trombone', TROMBONE, pitch(p), final, 2.6, 100)
    s.note('tuba', TUBA, pitch('D2'), final, 2.6, 104)
    for p in ('D4', 'F#4', 'A4', 'D5'):
        s.note('strings', STR, pitch(p), final, 3, 88)
    s.note('timp', TIMP, pitch('D3'), final, 1, 120)
    s.note('drums', 0, 49, final, 3, 108, drum=True)
    s.note('bells', BELLS, pitch('D5'), final, 2.5, 96)
    s.note('bells', BELLS, pitch('A4'), final + 0.9, 2.5, 84)
    return s, 6.0


# ---------------------------------------------------------------------------
# title: the main menu's theme. 4/4 at 104, F major. One unit = a quaver.
# Harp and plucked strings set off, the celesta and flute sing the tune,
# the horn takes the middle, and the strings join for the way home.

def title():
    s = Song(30 / 104)
    HARP, PIZZ, STR, CELESTA, FLUTE, HORN, GLOCK, TIMP = 46, 45, 48, 8, 73, 60, 9, 47
    intro = ['F', 'C', 'Dm', 'Bb']
    a = ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'Bb', 'C']
    b = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'C']
    bars = intro + a + b + a
    tune = [('A4', 2), ('C5', 2), ('F5', 3), ('E5', 1), ('D5', 2), ('E5', 2), ('G5', 3), ('F5', 1),
            ('F5', 2), ('E5', 2), ('D5', 2), ('C5', 2), ('D5', 6), ('C5', 2),
            ('A4', 2), ('C5', 2), ('F5', 3), ('A5', 1), ('G5', 2), ('E5', 2), ('C5', 3), ('D5', 1),
            ('F5', 2), ('D5', 2), ('Bb4', 2), ('D5', 2), ('E5', 4), ('C5', 4)]
    tune2 = tune[:-2] + [('C5', 2), ('E5', 2), ('G5', 2), ('Bb5', 2)]
    horn = [('A4', 4), ('D5', 4), ('F5', 6), ('D5', 2), ('C5', 4), ('A4', 4), ('G4', 6), ('C5', 2),
            ('D5', 2), ('E5', 2), ('F5', 4), ('F5', 2), ('G5', 2), ('F5', 2), ('D5', 2), ('D5', 4), ('Bb4', 4),
            ('C5', 4), ('E5', 2), ('G5', 2)]
    for bar, name in enumerate(bars):
        at = bar * 8
        root, third = chord(name)
        section = 0 if bar < 4 else 1 if bar < 12 else 2 if bar < 20 else 3
        # harp: rising and falling arpeggio in quavers
        h = place(root, 53, 65)
        arp = [h, h + third, h + 7, h + 12, h + 12 + third, h + 12, h + 7, h + third]
        for i, p in enumerate(arp):
            s.note('harp', HARP, p, at + i, 1.8, 66 if i % 4 == 0 else 54)
        # plucked bass on the beats
        bass = place(root, 41, 53)
        for i, p in enumerate([bass, bass + 7, bass + 12, bass + 7]):
            s.note('pizz', PIZZ, p, at + i * 2, 1, 74 if i == 0 else 60)
        if section >= 2:
            v = place(root, 60, 72)
            for p in (v, v + third, v + 7):
                s.note('strings', STR, p, at, 8, 44 if section == 2 else 50)
        if section == 2:
            s.note('timp', TIMP, place(root, 41, 53), at, 1, 62)
        # a soft tambourine on 2 and 4 once the tune is going
        if section >= 1:
            for i in (2, 6):
                s.note('drums', 0, 54, at + i, 0.5, 34, drum=True)
        if bar % 4 == 0:
            s.note('glock', GLOCK, place(root, 84, 96), at, 2, 40)
            s.note('glock', GLOCK, place(root, 84, 96) + 7, at + 1, 2, 34)
    s.melody('celesta', CELESTA, tune, 4 * 8, 84)
    s.melody('flute', FLUTE, tune, 4 * 8, 58, shift=-12)
    s.melody('horn', HORN, horn, 12 * 8, 80)
    s.melody('celesta', CELESTA, tune2, 20 * 8, 88)
    s.melody('flute', FLUTE, tune2, 20 * 8, 64)
    length = len(bars) * 8 * s.unit
    return s, length


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [
        ('harbour', harbour, True, -21),
        ('underway', underway, True, -20),
        ('storm', storm, True, -17),
        ('down', down, False, -18),
        ('home', home, False, -19),
        ('title', title, True, -20),
    ]
    for name, build, loop, level in jobs:
        song, length = build()
        y = master(render(song, name, length, loop), level)
        sf.write(OUT / f'{name}.wav', y, SR, subtype='PCM_16')
        print(f'{name}: {len(y) / SR:.2f} s, peak {np.abs(y).max():.2f}')
