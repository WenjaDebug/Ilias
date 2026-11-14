# Odysseus – Die Nacht des Pferdes

Ein Einzelspieler-3D-Schleichspiel im Browser, inspiriert von der *Ilias*.
Du bist Odysseus. Das Spiel beginnt in der Nacht nach dem trojanischen Siegesfest:
Du springst aus dem hölzernen Pferd und schleichst durch die schlafende Stadt – bis zum Tor.

Gebaut mit [Three.js](https://threejs.org), TypeScript und Vite.

## Spielen

**Im Browser:** <https://wenjadebug.github.io/Ilias/> – Link öffnen, ins Bild klicken, fertig.
Am besten in Chrome, Edge oder Safari auf einem Computer mit Maus und Tastatur.

**Auf dem eigenen Rechner:** Das Spiel braucht einen kleinen Webserver (direkt per Doppelklick auf `index.html` lädt es nicht).
Voraussetzung ist [Node.js](https://nodejs.org) 22 oder neuer.

```bash
git clone https://github.com/WenjaDebug/ilias.git
cd ilias
npm install
npm run dev
```

Dann <http://localhost:5173> im Browser öffnen und ins Bild klicken.

Oder als fertige Version: `npm run build`, danach `npm run preview` und die angezeigte Adresse öffnen.

## Steuerung

| Taste | Aktion |
| --- | --- |
| W A S D | bewegen |
| Maus | umsehen |
| Shift | rennen (laut!) |
| C / Ctrl | ducken, schleichen |
| Leertaste | springen, auf Kisten und Dächer klettern |
| E | lautlos töten (von hinten oder schlafend), Gegenstände aufheben |
| 1 / 2 (oder Q) | Schwert / Bogen |
| Rechte Maustaste | Bogen: genau zielen (Zoom) · Schwert: blocken |
| Linke Maustaste | Bogen: halten spannt, loslassen schießt · Schwert: schlagen (trifft den Gegner vor dem Fadenkreuz) |
| F | ausweichen |
| Esc / P | Pause |

## Spielregeln

- **Licht verrät dich.** Im Fackelschein sehen dich Wachen von weit her, im Schatten erst aus der Nähe. Geduckt bist du schwerer zu sehen.
- **Lärm weckt Schläfer.** Rennen, Springen und Kämpfe sind laut. Schleichen ist fast lautlos.
- **Alarm eskaliert.** Wer dich entdeckt, ruft – Schlafende wachen auf, und aus den Seitengassen kommen weitere Soldaten.
- **Checkpoints.** Wenn Odysseus fällt, geht es am letzten Checkpoint weiter.

## Entwickler-Optionen (URL-Parameter)

- `?debug` – Bildrate und Draw-Calls anzeigen
- `?skip` – Intro überspringen
- `?cp=alley|plaza|alley-b` – an einem Checkpoint starten
- `?q=low` – niedrigere Auflösung für schwache Rechner

## Projektaufbau

```
src/
  main.ts            Renderer, Ladebildschirm, Spielschleife
  world/level.ts     Level-Layout: Pferdeplatz, Gassen, Festplatz, Tor
  world/horse.ts     Das hölzerne Pferd (prozedural gebaut)
  world/textures.ts  PBR-Texturen (Poly Haven) und prozedurale Texturen
  world/sky.ts       Nachthimmel
  fx/fire.ts         Feuer, Glut, Licht-Pool
  fx/post.ts         Bloom, Farbgrading, Vignette, Filmkorn
  game/              Spieler, Kamera, Wachen-KI, Pfeile, Audio, Spielablauf
  ui/hud.ts          Anzeigen (Ziel, Texte, Auge, Lärm, Leben)
```

## Credits

- Figuren: Odysseus, die trojanischen Wachen und Helena wurden mit [Meshy](https://www.meshy.ai) erzeugt; die Griechen sind Odysseus in anderen Farben mit einem Helm aus Blender.
- Animationen: [Mixamo](https://www.mixamo.com) (Adobe), auf die Figuren übertragen mit `tools/blender/retarget.py`.
- Texturen und Nachthimmel: [Poly Haven](https://polyhaven.com) (CC0) – clay_plaster, plastered_stone_wall, cobblestone_large_01, large_sandstone_blocks, medieval_wood, brown_mud_dry, night_sky.
- `Soldier.glb` stammt aus den [three.js-Beispielen](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf).
- Gebäude, Pferd, Bäume, Ausrüstung und Requisiten sind mit Blender-Skripten gebaut (`tools/blender`); Feuer, Himmel und Klänge entstehen im Code.
