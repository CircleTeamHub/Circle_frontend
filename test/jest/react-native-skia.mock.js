// Skia ships as ESM on top of a JSI runtime: Jest can neither parse it nor
// provide the native side. Behavior tests only check what we hand to Skia
// (which shapes, which paragraph, which animated values), so the boundary is
// replaced with inspectable shells. A spec that needs more (e.g. the photo
// markup editor) still overrides this with its own jest.mock factory.
const React = require('react');
const { View } = require('react-native');

function container(displayName) {
  const Component = ({ children, mask, testID }) =>
    React.createElement(View, { testID }, mask, children);
  Component.displayName = displayName;
  return Component;
}

function leaf(displayName) {
  const Component = () => null;
  Component.displayName = displayName;
  return Component;
}

// Every paragraph the code under test builds, with the styles it pushed.
const builtParagraphs = [];

// The real JSI bindings check `hasProperty` and then read the value, so a key
// that is present but undefined throws on device. Fail the same way here.
function assertNoUndefinedKeys(value, path) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (nested === undefined) {
      throw new Error(`Skia JSI would throw: ${path}.${key} is undefined`);
    }
    assertNoUndefinedKeys(nested, `${path}.${key}`);
  }
}

function makeParagraph(record) {
  return {
    layout(width) {
      record.layoutWidth = width;
    },
    getHeight: () => 24,
    getLongestLine: () => 80,
    getMaxIntrinsicWidth: () => 80,
    dispose() {},
  };
}

const Skia = {
  ParagraphBuilder: {
    Make(paragraphStyle) {
      assertNoUndefinedKeys(paragraphStyle, 'paragraphStyle');
      const record = { paragraphStyle, textStyles: [], text: '' };
      const builder = {
        pushStyle(style) {
          assertNoUndefinedKeys(style, 'textStyle');
          record.textStyles.push(style);
          return builder;
        },
        addText(text) {
          record.text += text;
          return builder;
        },
        pop() {
          return builder;
        },
        build() {
          builtParagraphs.push(record);
          return makeParagraph(record);
        },
      };
      return builder;
    },
  },
  Color: (value) => value,
  Point: (x, y) => ({ x, y }),
};

module.exports = {
  __builtParagraphs: builtParagraphs,
  Canvas: container('Canvas'),
  Group: container('Group'),
  Mask: container('Mask'),
  Paragraph: leaf('Paragraph'),
  Rect: container('Rect'),
  LinearGradient: leaf('LinearGradient'),
  Skia,
  TextAlign: { Left: 0, Right: 1, Center: 2, Justify: 3, Start: 4, End: 5 },
  vec: (x = 0, y) => ({ x, y: y ?? x }),
};
