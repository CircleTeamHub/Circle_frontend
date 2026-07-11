const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const readJson = (path) => JSON.parse(read(path));
const FLIGHT_START_FRAME = 57;
const FLIGHT_END_FRAME = 123;
const HEADING_SAMPLE_WINDOW_FRAMES = 5;
const PLANE_NOSE_OFFSET_DEG = 27;
const SUBJECT_LAYER_NAMES = new Set([
  'Top open evlope 3',
  'Top open evlope 5',
  'Top open evlope 2',
  'lieftside 2',
  'lieftside',
  'Botom fold 2',
  'Botom fold',
  'Paper',
  'Top open evlope 6',
  'Back of evelope',
]);
const SUBJECT_VISIBLE_PAPER_HEXES = new Set([
  '#3B34B0',
  '#4A42D4',
  '#5B57E8',
  '#6366F1',
  '#7E82F5',
  '#9296F8',
  '#F1F0FF',
]);
const POOF_EFFECT_HEXES = new Set(['#ACEBF6', '#AAFBF9']);

const addPoint = (a, b) => [a[0] + b[0], a[1] + b[1], (a[2] ?? 0) + (b[2] ?? 0)];

const cubicAt = (p0, p1, p2, p3, progress) => {
  const inv = 1 - progress;
  return [0, 1, 2].map(
    (index) =>
      inv ** 3 * p0[index] +
      3 * inv ** 2 * progress * p1[index] +
      3 * inv * progress ** 2 * p2[index] +
      progress ** 3 * p3[index],
  );
};

const positionAtFrame = (positionKeyframes, frame) => {
  const firstFrame = positionKeyframes[0].t;
  const lastFrame = positionKeyframes.at(-1).t;
  const clampedFrame = Math.min(Math.max(frame, firstFrame), lastFrame);

  const keyframeIndex = positionKeyframes.findIndex((keyframe, index) => {
    const nextKeyframe = positionKeyframes[index + 1];
    return nextKeyframe && clampedFrame >= keyframe.t && clampedFrame <= nextKeyframe.t;
  });
  const keyframe = positionKeyframes[keyframeIndex];
  const nextKeyframe = positionKeyframes[keyframeIndex + 1];
  const progress = (clampedFrame - keyframe.t) / (nextKeyframe.t - keyframe.t);
  const p0 = keyframe.s;
  const p1 = addPoint(keyframe.s, keyframe.to ?? [0, 0, 0]);
  const p2 = addPoint(nextKeyframe.s, nextKeyframe.ti ?? [0, 0, 0]);
  const p3 = nextKeyframe.s;

  return cubicAt(p0, p1, p2, p3, progress);
};

const unwrapAngle = (angle, previousAngle) => {
  if (previousAngle === undefined) {
    return angle;
  }

  let unwrapped = angle;
  while (unwrapped - previousAngle > 180) {
    unwrapped -= 360;
  }
  while (unwrapped - previousAngle < -180) {
    unwrapped += 360;
  }
  return unwrapped;
};

const expectedFlightHeadings = (positionKeyframes) => {
  const headings = new Map();
  let previousHeading;

  for (let frame = FLIGHT_START_FRAME; frame <= FLIGHT_END_FRAME; frame += 1) {
    const before = positionAtFrame(positionKeyframes, frame - HEADING_SAMPLE_WINDOW_FRAMES);
    const after = positionAtFrame(positionKeyframes, frame + HEADING_SAMPLE_WINDOW_FRAMES);
    const rawHeading =
      (Math.atan2(after[1] - before[1], after[0] - before[0]) * 180) / Math.PI +
      PLANE_NOSE_OFFSET_DEG;
    const heading = unwrapAngle(rawHeading, previousHeading);

    headings.set(frame, heading);
    previousHeading = heading;
  }

  return headings;
};

const colorChannelToHex = (channel) =>
  Math.round(channel * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

const lottieColorToHex = (color) =>
  `#${color
    .slice(0, 3)
    .map((channel) => colorChannelToHex(channel))
    .join('')}`;

const collectLottieColors = (node, layerName, colors = []) => {
  if (!node || typeof node !== 'object') {
    return colors;
  }

  if ((node.ty === 'fl' || node.ty === 'st') && node.c?.k) {
    colors.push({
      layerName,
      type: node.ty,
      hex: lottieColorToHex(node.c.k),
    });
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      collectLottieColors(child, layerName, colors);
    }
    return colors;
  }

  for (const child of Object.values(node)) {
    collectLottieColors(child, layerName, colors);
  }

  return colors;
};

test('launch reveal plays the themed Lottie plane and Reanimated', () => {
  const source = read('src/components/app/launch-reveal.tsx');

  assert.match(source, /plane-fold\.json/);
  assert.match(source, /lottie-react-native/);
  assert.match(source, /useSharedValue/);
  assert.match(source, /useAnimatedStyle/);
  assert.match(source, /withTiming/);
  assert.match(source, /scheduleOnRN/);
});

test('launch reveal uses a linear clock so reveal thresholds match Lottie playback time', () => {
  const source = read('src/components/app/launch-reveal.tsx');

  assert.match(source, /LOTTIE_DURATION_MS/);
  assert.match(source, /DURATION_MS\s*=\s*LOTTIE_DURATION_MS\s*\+\s*REVEAL_BUFFER_MS/);
  assert.match(source, /easing:\s*Easing\.linear/);
  assert.doesNotMatch(source, /Easing\.inOut\(Easing\.cubic\)/);
});

test('launch plane flight rotation follows the flight path without boundary spin', () => {
  const lottie = readJson('assets/lottie/plane-fold.json');
  const flightLayer = lottie.layers.find((layer) => layer.nm === 'flight null');
  assert.ok(flightLayer, 'flight null layer should exist');
  assert.equal(flightLayer.ao, 0);

  const rotation = flightLayer.ks.r;
  const rotationKeyframes = rotation.k.filter((keyframe) => keyframe.t >= FLIGHT_START_FRAME);
  const rotationByFrame = new Map(rotationKeyframes.map((keyframe) => [keyframe.t, keyframe.s[0]]));
  const expectedHeadings = expectedFlightHeadings(flightLayer.ks.p.k);

  for (let frame = FLIGHT_START_FRAME; frame <= FLIGHT_END_FRAME; frame += 1) {
    assert.ok(rotationByFrame.has(frame), `expected rotation keyframe at frame ${frame}`);
    const actual = rotationByFrame.get(frame);
    const expected = expectedHeadings.get(frame);
    const error = Math.abs(actual - expected);

    assert.ok(
      error <= 1,
      `expected frame ${frame} heading ${expected.toFixed(2)}deg, received ${actual.toFixed(
        2,
      )}deg`,
    );
  }

  const rotationValues = Array.from(rotationByFrame.entries())
    .sort(([frameA], [frameB]) => frameA - frameB)
    .map(([, value]) => value);
  const deltas = rotationValues.slice(1).map((value, index) => value - rotationValues[index]);
  const maxStep = deltas.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const angleRange = Math.max(...rotationValues) - Math.min(...rotationValues);

  assert.ok(maxStep <= 40, `expected smooth turns, received ${maxStep.toFixed(2)}deg step`);
  assert.ok(
    angleRange >= 280,
    `expected flight-path heading changes, received ${angleRange.toFixed(2)}deg range`,
  );
});

test('launch Lottie envelope and plane fills use app purple and visible paper tint', () => {
  const lottie = readJson('assets/lottie/plane-fold.json');
  const colorItems = lottie.layers.flatMap((layer) => collectLottieColors(layer, layer.nm));
  const subjectFills = colorItems.filter(
    (item) => SUBJECT_LAYER_NAMES.has(item.layerName) && item.type === 'fl',
  );
  const subjectFillHexes = new Set(subjectFills.map((item) => item.hex));

  assert.equal(subjectFills.length, SUBJECT_LAYER_NAMES.size);
  for (const fill of subjectFills) {
    assert.ok(
      SUBJECT_VISIBLE_PAPER_HEXES.has(fill.hex),
      `expected ${fill.layerName} fill ${fill.hex} to use app purple and visible paper tint`,
    );
  }
  assert.ok(subjectFillHexes.has('#6366F1'), 'expected the primary purple to be used');
  assert.ok(subjectFillHexes.has('#F1F0FF'), 'expected visible paper-tinted surfaces to be used');
  assert.ok(!subjectFillHexes.has('#FFFFFF'), 'expected paper surfaces to avoid blending into white');

  const poofHexes = new Set(
    colorItems.filter((item) => item.layerName.startsWith('poof')).map((item) => item.hex),
  );
  assert.deepEqual(poofHexes, POOF_EFFECT_HEXES);
});

test('root layout hides native splash before playing the launch reveal overlay', () => {
  const source = read('app/_layout.tsx');

  assert.match(source, /import\s+\{\s*LaunchReveal\s*\}/);
  assert.match(source, /nativeSplashHidden/);
  assert.match(source, /SplashScreen\.hideAsync\(\)/);
  assert.match(source, /<LaunchReveal\s+play=\{nativeSplashHidden\}/);
});
