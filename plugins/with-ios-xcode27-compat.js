const {
  withAppDelegate,
  withInfoPlist,
  withPodfile,
} = require('expo/config-plugins');

// Xcode 27 / iOS 27 兼容。ios/ 不进 git，每次 prebuild 都会重新生成，
// 所以必须由插件写回，否则本地/CI 用 Xcode 27 打包会编不过或启动即崩：
//  1. Pods 里部署目标低于 15 的 target 直接编译报错 → post_install 抬到 15.1
//     （只抬低的，expo-router 等要求 16 的不动，否则反而编不过）。
//  2. 用 iOS 27 SDK 链接、却没采用 UIScene 生命周期的 App 在 iOS 27 上启动即
//     被系统终止（_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption）
//     → 声明 scene manifest + 最小 SceneDelegate。

const POD_TARGET_FLOOR = '15.1';
const POD_MARKER = '# [with-ios-xcode27-compat] deployment target floor';
const SCENE_MARKER = '// [with-ios-xcode27-compat] SceneDelegate';
const SCENE_DELEGATE_CLASS = '$(PRODUCT_MODULE_NAME).SceneDelegate';

const POD_SNIPPET = `
    ${POD_MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        current = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current && Gem::Version.new(current) < Gem::Version.new('${POD_TARGET_FLOOR}')
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${POD_TARGET_FLOOR}'
        end
      end
    end`;

const SCENE_DELEGATE_SWIFT = `
${SCENE_MARKER}
// 只做最小接入：沿用 AppDelegate 里已启动好 React Native 的 window，挂到系统创建的
// scene 上；深链 / 通用链接转发回 AppDelegate 原有的处理（RCTLinkingManager 等）。
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let appWindow = appDelegate.window else { return }
    appWindow.windowScene = windowScene
    appWindow.frame = windowScene.coordinateSpace.bounds
    appWindow.makeKeyAndVisible()
    window = appWindow

    if let urlContext = connectionOptions.urlContexts.first {
      openURL(urlContext)
    }
    if let activity = connectionOptions.userActivities.first {
      continueActivity(activity)
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    URLContexts.forEach(openURL)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    continueActivity(userActivity)
  }

  private func openURL(_ context: UIOpenURLContext) {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    if let source = context.options.sourceApplication {
      options[.sourceApplication] = source
    }
    _ = UIApplication.shared.delegate?.application?(
      UIApplication.shared, open: context.url, options: options)
  }

  private func continueActivity(_ activity: NSUserActivity) {
    _ = UIApplication.shared.delegate?.application?(
      UIApplication.shared, continue: activity, restorationHandler: { _ in })
  }
}
`;

/** 在 react_native_post_install(...) 调用之后插入部署目标下限；幂等。 */
function addPodDeploymentTargetFloor(podfile) {
  if (podfile.includes(POD_MARKER)) return podfile;
  const anchor = /(react_native_post_install\([\s\S]*?\n\s*\))/;
  if (!anchor.test(podfile)) {
    throw new Error(
      '[with-ios-xcode27-compat] Podfile 里找不到 react_native_post_install(...)，模板可能变了',
    );
  }
  return podfile.replace(anchor, `$1${POD_SNIPPET}`);
}

/** Xcode header lookup must not resolve the system's same-named sqlite3.h. */
function addSqliteHeaderNamespace(podfile) {
  const marker = '# [with-ios-xcode27-compat] namespaced SQLite header';
  if (podfile.includes(marker)) return podfile;
  const anchor = /(react_native_post_install\([\s\S]*?\n\s*\))/;
  if (!anchor.test(podfile)) throw new Error('Missing React Native post_install hook');
  return podfile.replace(anchor, `$1
    ${marker}
    sqlite_umbrella = installer.sandbox.root + 'Target Support Files/ExpoSQLite/ExpoSQLite-umbrella.h'
    if File.exist?(sqlite_umbrella)
      original = File.read(sqlite_umbrella)
      namespaced = original.gsub('#import "sqlite3.h"', '#import <ExpoSQLite/sqlite3.h>')
      File.write(sqlite_umbrella, namespaced) if namespaced != original
    end`);
}

/** 返回带 scene manifest 的新 Info.plist 对象（不改入参）。 */
function addSceneManifest(infoPlist) {
  return {
    ...infoPlist,
    UIApplicationSceneManifest: {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default',
            UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
          },
        ],
      },
    },
  };
}

/** 在 AppDelegate.swift 末尾追加 SceneDelegate；幂等。 */
function addSceneDelegate(appDelegate) {
  if (appDelegate.includes(SCENE_MARKER)) return appDelegate;
  if (!/class AppDelegate\b/.test(appDelegate) || !/var window: UIWindow\?/.test(appDelegate)) {
    throw new Error(
      '[with-ios-xcode27-compat] AppDelegate.swift 结构不符合预期（缺 AppDelegate.window），SceneDelegate 无法接管窗口',
    );
  }
  return `${appDelegate.trimEnd()}\n${SCENE_DELEGATE_SWIFT}`;
}

function withIosXcode27Compat(config) {
  config = withPodfile(config, (modConfig) => {
    modConfig.modResults.contents = addSqliteHeaderNamespace(addPodDeploymentTargetFloor(
      modConfig.modResults.contents,
    ));
    return modConfig;
  });
  config = withInfoPlist(config, (modConfig) => {
    modConfig.modResults = addSceneManifest(modConfig.modResults);
    return modConfig;
  });
  config = withAppDelegate(config, (modConfig) => {
    if (modConfig.modResults.language !== 'swift') {
      throw new Error('[with-ios-xcode27-compat] 只支持 Swift AppDelegate');
    }
    modConfig.modResults.contents = addSceneDelegate(modConfig.modResults.contents);
    return modConfig;
  });
  return config;
}

module.exports = withIosXcode27Compat;
module.exports.addPodDeploymentTargetFloor = addPodDeploymentTargetFloor;
module.exports.addSceneManifest = addSceneManifest;
module.exports.addSceneDelegate = addSceneDelegate;

module.exports.addSqliteHeaderNamespace = addSqliteHeaderNamespace;
