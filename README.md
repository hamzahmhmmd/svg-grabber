# svg-grabber

Easily preview and extract all SVG assets from any website. With svg-grabber, you can instantly access, download, or copy the code for every SVG icon and illustration, making them ready to use in your favorite design tools, such as Sketch, Figma, or Framer.

![alt text](/images/svg-grabber-screenshot-01.png 'Screenshot of svg-grabber, a Chrome extension to preview, copy and download svg images from any website.')

## Animated SVG capture

Click the extension and keep the source tab visible while the icon shows **REC**
(8 seconds). Play or hover the illustration during capture. JavaScript-driven
vector changes (including Lottie SVG renderers) are sampled at about 30 fps and
exported as a repeating 8-second SVG clip using SVG/CSS animation. Copy, individual
download, and ZIP download use the same animated file; no website scripts are
included in the recording. Open the downloaded SVG in Chrome to play it.

CSS/Web Animations with replace composition and native SVG animations are
preserved where supported. Gallery previews use isolated SVG images so styles,
keyframe names, and IDs cannot collide between cards.

### Capture limits

- A recorded clip replays observed motion; it does not recover the original
  Lottie project, original loop boundary, hover logic, or scroll/mouse controls.
  The end of the clip may jump back to its first frame.
- Paused, offscreen, or reduced-motion artwork may not move during capture. A
  card marked **Snapshot - no motion recorded** is not an animated recording.
- JavaScript changes to the SVG element tree and recordings over the per-SVG
  4 MiB track budget fall back to a labeled snapshot. Canvas/WebGL renderers,
  ancestor animation, additive animation, and inaccessible iframe/shadow content
  are outside this capture path. Existing `<use>` exclusions still apply.
- The approximate 30 fps rate can drop on busy pages. Some editors import only
  static SVG content even when the SVG animates in a browser.

### Development checks

```sh
npm ci
npm test
npm run build
npx eslint .
```

Run a single test file with `node --test tests/animation-capture.test.js`.
Serve the repository root and open `tests/browser-fixture.html` in Chrome for
an image-context playback check (the page reports PASS/FAIL for transform motion).
For the Claude scientists page, keep the hero illustration visible during REC,
then open the exported SVG directly and verify motion in both gallery and file.

## Third party libraries

svg-grabber uses the following libraries:

- **FileSaver.js**
  Copyright © 2016 [Eli Grey](https://eligrey.com)
  https://github.com/eligrey/FileSaver.js
  [MIT License](https://github.com/eligrey/FileSaver.js/blob/master/LICENSE.md)
- **Data Driven Documents**
  Copyright © 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso
  https://stuk.github.io/jszip
  [MIT License](https://github.com/Stuk/jszip/blob/master/LICENSE.markdown)

## Contributing

Please read our [code of conduct](/code-of-conduct.md) for contributors.
