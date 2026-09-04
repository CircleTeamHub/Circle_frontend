import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_DOTS,
  DAY_SPARKLES,
  HEADING_ZONE,
  HERO_CONTENT_TOP,
  NIGHT_STARS,
  PLANE_BOX,
  SKY_HEIGHT,
  SKY_MAX_WIDTH,
  SKY_WIDTH,
  TRAIL_PATH,
  getSkyLayout,
  sparklePath,
} from './login-sky-geometry.ts';

const inside = (x: number, y: number) =>
  x >= 0 && x <= SKY_WIDTH && y >= 0 && y <= SKY_HEIGHT;
const onHeading = (x: number, y: number) =>
  x < HEADING_ZONE.right && y > HEADING_ZONE.top;

test('night stars stay inside the hero, off the heading, and dim', () => {
  assert.ok(NIGHT_STARS.length >= 30);
  for (const star of NIGHT_STARS) {
    assert.ok(inside(star.x, star.y), `star ${star.x},${star.y} outside hero`);
    assert.ok(!onHeading(star.x, star.y), `star ${star.x},${star.y} on heading`);
    assert.ok(star.r >= 1 && star.r <= 2, `star radius ${star.r}`);
    assert.ok(star.opacity >= 0.1 && star.opacity <= 0.45, `star opacity ${star.opacity}`);
  }
});

test('day dots and sparkles stay inside the hero and off the heading', () => {
  assert.ok(DAY_DOTS.length >= 15);
  assert.equal(DAY_SPARKLES.length, 6);
  for (const dot of DAY_DOTS) {
    assert.ok(inside(dot.x, dot.y), `dot ${dot.x},${dot.y} outside hero`);
    assert.ok(!onHeading(dot.x, dot.y), `dot ${dot.x},${dot.y} on heading`);
    assert.ok(dot.opacity <= 0.5, `dot opacity ${dot.opacity}`);
  }
  for (const sparkle of DAY_SPARKLES) {
    assert.ok(inside(sparkle.x, sparkle.y), `sparkle ${sparkle.x},${sparkle.y} outside hero`);
    assert.ok(!onHeading(sparkle.x, sparkle.y), `sparkle ${sparkle.x},${sparkle.y} on heading`);
    assert.ok(sparkle.size >= 4 && sparkle.size <= 10, `sparkle size ${sparkle.size}`);
    assert.ok(sparkle.opacity <= 0.6, `sparkle opacity ${sparkle.opacity}`);
  }
});

test('sparklePath draws a closed four-point star around the origin', () => {
  const d = sparklePath(8);
  assert.match(d, /^M0 -8 /);
  assert.match(d, /Q0 0 8 0/);
  assert.match(d, /Q0 0 -8 0/);
  assert.match(d, /Z$/);
});

test('the trail ends at the plane tail', () => {
  assert.match(TRAIL_PATH, /^M166 104 /);
  assert.match(TRAIL_PATH, /238 204$/);
  assert.ok(PLANE_BOX.left <= 238 && 238 <= PLANE_BOX.left + PLANE_BOX.size);
  assert.ok(PLANE_BOX.top <= 204 && 204 <= PLANE_BOX.top + PLANE_BOX.size);
});

test('sky layout is 1:1 on a 390pt phone and scales with width', () => {
  const phone = getSkyLayout(390);
  assert.equal(phone.scale, 1);
  assert.equal(phone.width, SKY_WIDTH);
  assert.equal(phone.height, SKY_HEIGHT);
  assert.equal(phone.contentTop, HERO_CONTENT_TOP);
  assert.equal(phone.offsetX, 0);

  const small = getSkyLayout(360);
  assert.ok(small.scale < 1 && small.scale > 0.9);
  assert.equal(small.width, 360);
  assert.equal(small.offsetX, 0);

  // 比 320 还窄的屏：hero 保持 320 宽，两侧各溢出一点而不是继续缩。
  const tiny = getSkyLayout(300);
  assert.equal(tiny.width, 320);
  assert.equal(tiny.offsetX, -10);
});

test('sky layout clamps on tablets and web and centers the hero', () => {
  const wide = getSkyLayout(1200);
  assert.equal(wide.width, SKY_MAX_WIDTH);
  assert.equal(wide.scale, SKY_MAX_WIDTH / SKY_WIDTH);
  assert.equal(wide.offsetX, (1200 - SKY_MAX_WIDTH) / 2);
  assert.ok(wide.contentTop > HERO_CONTENT_TOP);
});
