import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { captureAnimatedSVGs } from '../src/svg-processor/animation-capture.js';

const fixture = (markup) => {
  const dom = new JSDOM(markup, { pretendToBeVisual: true });
  return { dom, svg: dom.window.document.querySelector('svg') };
};

test('serializes external CSS animation keyframes and timing into the SVG', async () => {
  const { dom, svg } = fixture(
    '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'
  );
  const target = svg.firstChild;
  // jsdom has no Web Animations implementation; supply that browser boundary.
  target.getAnimations = () => [
    {
      effect: {
        target,
        pseudoElement: null,
        getKeyframes: () => [
          {
            computedOffset: 0,
            opacity: '0',
            easing: 'ease-in',
            composite: 'replace',
          },
          {
            computedOffset: 1,
            opacity: '1',
            easing: 'linear',
            composite: 'replace',
          },
        ],
        getTiming: () => ({
          duration: 1500,
          iterations: Infinity,
          delay: 200,
          direction: 'alternate',
          easing: 'linear',
          fill: 'both',
          composite: 'replace',
        }),
      },
    },
  ];
  const [result] = await captureAnimatedSVGs([svg], {
    durationMs: 20,
    intervalMs: 10,
  });
  assert.equal(result.getAttribute('data-svg-grabber-motion'), 'css');
  assert.match(result.querySelector('style').textContent, /0%\{opacity:0/);
  assert.match(
    result.querySelector('circle').getAttribute('style'),
    /1500ms linear 200ms infinite alternate both/
  );
  dom.window.close();
});

test('falls back to a labeled snapshot when motion exceeds the size budget', async () => {
  const { dom, svg } = fixture(
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'
  );
  const capture = captureAnimatedSVGs([svg], {
    durationMs: 60,
    intervalMs: 10,
  });
  dom.window.setTimeout(
    () => svg.firstChild.setAttribute('d', 'M0 0' + 'L1 1'.repeat(1100000)),
    10
  );
  const [result] = await capture;
  assert.equal(result.getAttribute('data-svg-grabber-motion'), 'size-limit');
  assert.equal(result.querySelector('animate'), null);
  dom.window.close();
});

test('replays JS-driven path and visibility changes without modifying the source', async () => {
  const { dom, svg } = fixture(
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1" style="display:block"/></svg>'
  );
  const capture = captureAnimatedSVGs([svg], {
    durationMs: 120,
    intervalMs: 10,
  });
  dom.window.setTimeout(() => {
    svg.firstChild.setAttribute('d', 'M0 0L9 9');
    svg.firstChild.style.display = 'none';
  }, 30);
  const [result] = await capture;
  const animation = result.querySelector('animate[attributeName="d"]');
  assert.ok(animation, 'changing paths must have a replay timeline');
  assert.match(animation.getAttribute('values'), /^M0 0L1 1;M0 0L9 9/);
  assert.equal(animation.getAttribute('repeatCount'), 'indefinite');
  assert.match(result.querySelector('style').textContent, /display:none/);
  assert.equal(svg.querySelector('animate'), null);
  assert.equal(svg.firstChild.getAttribute('d'), 'M0 0L9 9');
  dom.window.close();
});

test('preserves native SMIL and internal styles for static SVGs', async () => {
  const { dom, svg } = fixture(
    '<svg xmlns="http://www.w3.org/2000/svg"><style>.dot{fill:red}</style><circle class="dot"><animate attributeName="r" values="1;5" dur="1s" repeatCount="indefinite"/></circle></svg>'
  );
  const [result] = await captureAnimatedSVGs([svg], {
    durationMs: 30,
    intervalMs: 10,
  });
  assert.equal(result.querySelectorAll('animate').length, 1);
  assert.equal(result.querySelector('circle').getAttribute('class'), 'dot');
  assert.equal(result.getAttribute('data-svg-grabber-motion'), null);
  dom.window.close();
});

test('does not export incomplete motion when the vector structure changes', async () => {
  const { dom, svg } = fixture(
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'
  );
  const capture = captureAnimatedSVGs([svg], {
    durationMs: 70,
    intervalMs: 10,
  });
  dom.window.setTimeout(
    () =>
      svg.appendChild(
        dom.window.document.createElementNS(svg.namespaceURI, 'circle')
      ),
    20
  );
  const [result] = await capture;
  assert.equal(
    result.getAttribute('data-svg-grabber-motion'),
    'unsupported-structure'
  );
  assert.equal(result.querySelector('animate'), null);
  dom.window.close();
});

test('exports Lottie matrix transforms as CSS with a fixed SVG origin', async () => {
  const { dom, svg } = fixture(
    '<svg xmlns="http://www.w3.org/2000/svg"><g transform="matrix(1 0 0 1 0 0)"><circle r="4"/></g></svg>'
  );
  const capture = captureAnimatedSVGs([svg], {
    durationMs: 70,
    intervalMs: 10,
  });
  dom.window.setTimeout(
    () => svg.firstChild.setAttribute('transform', 'matrix(0,-1,1,0,90,40)'),
    20
  );
  const [result] = await capture;
  const css = result.querySelector('style')?.textContent || '';
  assert.match(css, /transform:matrix\(0,-1,1,0,90,40\)/);
  assert.equal(result.querySelector('g').style.transformOrigin, '0 0');
  assert.equal(
    result.querySelector('animate[attributeName="transform"]'),
    null
  );
  dom.window.close();
});
