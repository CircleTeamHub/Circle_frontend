const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const plugin = require('../plugins/with-ios-xcode27-compat');

const PODFILE = `target 'app' do
  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
    )
  end
end
`;

const APP_DELEGATE = `@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
}
`;

test('app.json registers the Xcode 27 compat plugin', () => {
  const app = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'app.json'), 'utf8')).expo;
  assert.ok(app.plugins.includes('./plugins/with-ios-xcode27-compat'));
});

test('Podfile gets a 15.1 deployment-target floor that only raises lower targets, once', () => {
  const once = plugin.addPodDeploymentTargetFloor(PODFILE);
  assert.match(once, /react_native_post_install\([\s\S]*?\)\n\s*# \[with-ios-xcode27-compat\]/);
  assert.match(once, /Gem::Version\.new\(current\) < Gem::Version\.new\('15\.1'\)/);
  assert.equal(plugin.addPodDeploymentTargetFloor(once), once);
  assert.throws(() => plugin.addPodDeploymentTargetFloor('post_install do |i|\nend'), /react_native_post_install/);
});

test('Info.plist declares a single-scene manifest pointing at SceneDelegate', () => {
  const input = { CFBundleName: 'app' };
  const out = plugin.addSceneManifest(input);
  assert.equal(input.UIApplicationSceneManifest, undefined, 'must not mutate the input');
  assert.equal(out.CFBundleName, 'app');
  assert.deepEqual(out.UIApplicationSceneManifest, {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [
        {
          UISceneConfigurationName: 'Default',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
        },
      ],
    },
  });
});

test('AppDelegate gets a SceneDelegate that reuses the RN window and forwards links, once', () => {
  const once = plugin.addSceneDelegate(APP_DELEGATE);
  assert.match(once, /class SceneDelegate: UIResponder, UIWindowSceneDelegate/);
  assert.match(once, /appWindow\.windowScene = windowScene/);
  assert.match(once, /openURLContexts/);
  assert.match(once, /continue userActivity: NSUserActivity/);
  assert.equal(plugin.addSceneDelegate(once), once);
  assert.throws(() => plugin.addSceneDelegate('class Foo {}'), /AppDelegate/);
});

test('expo-router patch guards the iOS 16-only UIMenu subtitle', () => {
  const patches = fs.readdirSync(path.join(process.cwd(), 'patches'));
  const routerPatch = patches.find((name) => name.startsWith('expo-router+'));
  assert.ok(routerPatch, 'patches/expo-router+*.patch is missing');
  const body = fs.readFileSync(path.join(process.cwd(), 'patches', routerPatch), 'utf8');
  assert.match(body, /\+\s+if #available\(iOS 16\.0, \*\), let subtitle = subtitle \{/);
});
