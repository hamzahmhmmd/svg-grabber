const SVG_NS = 'http://www.w3.org/2000/svg';
const MOTION_ATTRIBUTES = new Set([
  'd',
  'points',
  'transform',
  'opacity',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'viewBox',
  'visibility',
  'display',
]);
const VISUAL_PROPERTIES = [
  'color',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'visibility',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'transform-origin',
  'transform-box',
];
const MAX_TRACK_CHARACTERS = 4 * 1024 * 1024;

const cssProperty = (name) =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const safeCssValue = (value) => !/[{}<>]|url\s*\(|@import/i.test(String(value));
const elements = (root) => [root, ...root.querySelectorAll('*')];

// Copy appearance before detaching: page selectors and inherited colors disappear
// in a downloaded SVG. Do not copy CSS transforms over SVG transform attributes.
const copyAppearance = (source, target, view) => {
  if (!source.isConnected || !view) return;
  const computed = view.getComputedStyle(source);
  for (const property of VISUAL_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (value && safeCssValue(value)) target.style.setProperty(property, value);
  }
};

const addCssAnimation = (target, name, frames, timing, styles) => {
  if (
    !frames.length ||
    !Number.isFinite(timing.duration) ||
    timing.duration <= 0
  )
    return false;
  const rules = frames
    .map((frame) => {
      const declarations = Object.entries(frame)
        .filter(
          ([key, value]) =>
            !['offset', 'computedOffset', 'easing', 'composite'].includes(
              key
            ) && safeCssValue(value)
        )
        .map(([key, value]) => `${cssProperty(key)}:${value}`)
        .join(';');
      const offset = frame.computedOffset ?? frame.offset;
      return `${Math.max(0, Math.min(1, offset)) * 100}%{${declarations};animation-timing-function:${safeCssValue(frame.easing || 'linear') ? frame.easing || 'linear' : 'linear'}}`;
    })
    .join('');
  styles.push(`@keyframes ${name}{${rules}}`);
  const iterations =
    timing.iterations === Infinity ? 'infinite' : timing.iterations;
  const animation = `${name} ${timing.duration}ms ${timing.easing || 'linear'} ${timing.delay || 0}ms ${iterations} ${timing.direction || 'normal'} ${timing.fill || 'none'}`;
  const existing = target.style.getPropertyValue('animation');
  target.style.setProperty(
    'animation',
    existing ? `${existing},${animation}` : animation
  );
  return true;
};

const createRecording = (source) => {
  const view = source.ownerDocument.defaultView;
  const clone = source.cloneNode(true);
  clone.setAttribute('xmlns', SVG_NS);
  const originals = elements(source);
  const copies = elements(clone);
  const indexes = new Map(originals.map((element, index) => [element, index]));
  const styles = [];
  let cssCount = 0;
  originals.forEach((element, index) => {
    const target = copies[index];
    copyAppearance(element, target, view);
    // Web Animations exposes CSS keyframes without reading cross-origin sheets.
    for (const animation of element.getAnimations?.() || []) {
      const effect = animation.effect;
      if (!effect || effect.target !== element || effect.pseudoElement)
        continue;
      const frames = effect.getKeyframes();
      const timing = effect.getTiming();
      if (timing.composite && timing.composite !== 'replace') continue;
      if (
        addCssAnimation(
          target,
          `grab_css_${index}_${cssCount}`,
          frames,
          timing,
          styles
        )
      )
        cssCount++;
    }
  });
  const initialAttributes = originals.map(
    (element) =>
      new Map(
        Array.from(element.attributes, ({ name, value }) => [name, value])
      )
  );
  return {
    source,
    clone,
    originals,
    copies,
    indexes,
    initialAttributes,
    styles,
    cssCount,
    tracks: new Map(),
    pending: new Set(),
    characters: 0,
    unsupported: '',
  };
};

const sample = (recording, elapsed) => {
  for (const key of recording.pending) {
    const [indexText, attribute] = key.split(':');
    const index = Number(indexText);
    const source = recording.originals[index];
    const raw = source.getAttribute(attribute) || '';
    const value =
      attribute === 'd' && !raw
        ? 'M0 0'
        : attribute === 'transform' && !raw
          ? 'matrix(1 0 0 1 0 0)'
          : raw;
    let track = recording.tracks.get(key);
    if (!track) {
      track = {
        index,
        attribute,
        samples: [
          [
            0,
            recording.initialAttributes[index].get(attribute) ||
              (attribute === 'd'
                ? 'M0 0'
                : attribute === 'transform'
                  ? 'matrix(1 0 0 1 0 0)'
                  : ''),
          ],
        ],
      };
      recording.tracks.set(key, track);
    }
    if (track.samples.at(-1)[1] === value) continue;
    track.samples.push([elapsed, value]);
    recording.characters += value.length;
    if (recording.characters > MAX_TRACK_CHARACTERS)
      recording.unsupported = 'size-limit';
  }
  recording.pending.clear();
};

// SVG accepts unitless transform arguments; CSS requires lengths and angles.
const svgTransformToCss = (value) => {
  if (!value.trim()) return 'none';
  return value.replace(/([a-zA-Z]+)\(([^)]*)\)/g, (_, name, argumentsText) => {
    const values = argumentsText
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (values.some((number) => !Number.isFinite(number))) return 'none';
    if (name === 'matrix' && values.length === 6)
      return `matrix(${values.join(',')})`;
    if (name === 'translate')
      return `translate(${values[0]}px,${values[1] || 0}px)`;
    if (name === 'scale')
      return `scale(${values[0]},${values[1] ?? values[0]})`;
    if (name === 'rotate') {
      const rotation = `rotate(${values[0]}deg)`;
      return values.length === 3
        ? `translate(${values[1]}px,${values[2]}px) ${rotation} translate(${-values[1]}px,${-values[2]}px)`
        : rotation;
    }
    if (name === 'skewX' || name === 'skewY') return `${name}(${values[0]}deg)`;
    return 'none';
  });
};

const finishRecording = (recording, duration) => {
  const { clone, copies, tracks, styles } = recording;
  let animatedTracks = 0;
  if (!recording.unsupported) {
    for (const { index, attribute, samples } of tracks.values()) {
      if (samples.length < 2) continue;
      const target = copies[index];
      if (attribute === 'transform') {
        target.style.setProperty('transform-origin', '0 0');
        target.style.setProperty('transform-box', 'view-box');
        const frames = samples.map(([time, value]) => ({
          offset: time / duration,
          transform: svgTransformToCss(value),
          easing: 'steps(1, end)',
        }));
        frames.push({ ...frames.at(-1), offset: 1 });
        addCssAnimation(
          target,
          `grab_transform_${index}`,
          frames,
          {
            duration,
            iterations: Infinity,
            easing: 'steps(1, end)',
            fill: 'both',
          },
          styles
        );
      } else if (attribute === 'style') {
        const frames = samples.map(([time, value]) => {
          const scratch = clone.ownerDocument.createElementNS(SVG_NS, 'g');
          scratch.setAttribute('style', value);
          const frame = { offset: time / duration, easing: 'steps(1, end)' };
          for (let i = 0; i < scratch.style.length; i++) {
            const property = scratch.style[i];
            if (
              MOTION_ATTRIBUTES.has(property) ||
              ['transform-origin', 'transform-box'].includes(property)
            ) {
              frame[property] = scratch.style.getPropertyValue(property);
            }
          }
          return frame;
        });
        // Explicit defaults make removed style properties replay rather than interpolate.
        const properties = new Set(
          frames
            .flatMap((frame) => Object.keys(frame))
            .filter((key) => !['offset', 'easing'].includes(key))
        );
        if (!properties.size) continue;
        for (const frame of frames) {
          for (const property of properties) frame[property] ??= 'initial';
        }
        frames.push({ ...frames.at(-1), offset: 1 });
        addCssAnimation(
          target,
          `grab_js_${index}`,
          frames,
          {
            duration,
            iterations: Infinity,
            easing: 'steps(1, end)',
            fill: 'both',
          },
          styles
        );
      } else {
        // An inline presentation property overrides an SMIL presentation attribute.
        target.style.removeProperty(attribute);
        const animation = clone.ownerDocument.createElementNS(
          SVG_NS,
          'animate'
        );
        animation.setAttribute('attributeName', attribute);
        animation.setAttribute(
          'values',
          [...samples.map(([, value]) => value), samples.at(-1)[1]].join(';')
        );
        animation.setAttribute(
          'keyTimes',
          [
            ...samples.map(([time]) =>
              Math.min(time / duration, 0.999999).toFixed(6)
            ),
            '1',
          ].join(';')
        );
        animation.setAttribute('dur', `${duration}ms`);
        animation.setAttribute('calcMode', 'discrete');
        animation.setAttribute('repeatCount', 'indefinite');
        target.appendChild(animation);
      }
      animatedTracks++;
    }
  }
  if (styles.length) {
    const style = clone.ownerDocument.createElementNS(SVG_NS, 'style');
    style.textContent = styles.join('\n');
    clone.prepend(style);
  }
  if (recording.unsupported || animatedTracks || recording.cssCount) {
    clone.setAttribute(
      'data-svg-grabber-motion',
      recording.unsupported || (animatedTracks ? 'recorded' : 'css')
    );
  }
  if (animatedTracks)
    clone.setAttribute('data-svg-grabber-duration', String(duration));
  return clone;
};

// Observe in the isolated content world: no page scripts, player internals, or
// extra permissions are needed. Only safe vector attributes are recorded.
export const captureAnimatedSVGs = async (
  nodes,
  { durationMs = 8000, intervalMs = 33 } = {}
) => {
  const recordings = nodes.map(createRecording);
  if (!recordings.length) return [];
  const view = nodes[0].ownerDocument.defaultView;
  const start = view.performance.now();
  const observers = recordings.map((recording) => {
    const observer = new view.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          recording.unsupported = 'unsupported-structure';
          continue;
        }
        const index = recording.indexes.get(mutation.target);
        const attribute = mutation.attributeName;
        if (
          index !== undefined &&
          (MOTION_ATTRIBUTES.has(attribute) || attribute === 'style')
        ) {
          recording.pending.add(`${index}:${attribute}`);
        }
      }
    });
    observer.observe(recording.source, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    return observer;
  });
  try {
    await new Promise((resolve) => {
      const tick = () => {
        const elapsed = view.performance.now() - start;
        recordings.forEach((recording) => {
          if (!recording.unsupported)
            sample(recording, Math.min(elapsed, durationMs - 0.01));
        });
        if (elapsed >= durationMs) resolve();
        else view.setTimeout(tick, Math.min(intervalMs, durationMs - elapsed));
      };
      tick();
    });
  } finally {
    observers.forEach((observer) => observer.disconnect());
  }
  return recordings.map((recording) => finishRecording(recording, durationMs));
};
