const test = require('node:test');
const assert = require('node:assert/strict');

test('@expo/plist parses generated iOS Info.plist XML', () => {
  const { parse } = require('@expo/plist/build/parse');

  const plist = parse(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
</dict>
</plist>`);

  assert.equal(plist.CFBundleIdentifier, '$(PRODUCT_BUNDLE_IDENTIFIER)');
});
