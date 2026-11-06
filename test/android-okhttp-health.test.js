const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 2026-11：安卓 14 天 225 次请求超时，成批出现在回到前台那一刻；抽查一半请求根本没到
// 服务器，另一半到了、秒回却没送回 JS。RN 默认的 OkHttp 无读超时、无 HTTP/2 心跳，
// 半死的连接会一直被复用。插件给 RN 网络层换上带心跳、短空闲回收的 OkHttp。

// expo prebuild（SDK 55）生成的 MainApplication.kt，原样照抄。
const GENERATED_MAIN_APPLICATION = `package com.yiboding.circleim

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }

  override fun onCreate() {
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
`;

function runPlugin(contents) {
  const plugin = require('../plugins/with-android-okhttp-health');
  const config = plugin({ name: 'okhttp-test', slug: 'okhttp-test' });
  return config.mods.android.mainApplication({
    ...config,
    modResults: { language: 'kt', contents },
    modRequest: { platform: 'android', modName: 'mainApplication' },
  });
}

test('the RN networking client gets HTTP/2 pings and a short idle pool, keeping RN defaults', async () => {
  const out = (await runPlugin(GENERATED_MAIN_APPLICATION)).modResults.contents;

  assert.match(out, /^import com\.facebook\.react\.modules\.network\.OkHttpClientProvider$/m);
  assert.match(out, /^import okhttp3\.ConnectionPool$/m);
  assert.match(out, /^import java\.util\.concurrent\.TimeUnit$/m);
  // 必须从 RN 自己的 builder 起步：它带 ReactCookieJarContainer（NetworkingModule 会强转它）
  // 和 10MB 磁盘缓存；自己 new OkHttpClient.Builder() 会在第一次请求时崩溃。
  assert.match(out, /OkHttpClientProvider\.createClientBuilder\(applicationContext\)/);
  assert.match(out, /\.pingInterval\(5, TimeUnit\.SECONDS\)/);
  assert.match(out, /ConnectionPool\(5, 30, TimeUnit\.SECONDS\)/);
  // 工厂要在 React 起来之前装好：NetworkingModule 建 client 时只问一次。
  const factoryAt = out.indexOf('OkHttpClientProvider.setOkHttpClientFactory');
  assert.ok(factoryAt > out.indexOf('super.onCreate()'));
  assert.ok(factoryAt < out.indexOf('loadReactNative(this)'));
});

test('running prebuild twice does not inject the factory twice', async () => {
  const once = (await runPlugin(GENERATED_MAIN_APPLICATION)).modResults.contents;
  const twice = (await runPlugin(once)).modResults.contents;
  assert.equal(twice, once);
  assert.equal(once.match(/setOkHttpClientFactory/g).length, 1);
  assert.equal(once.match(/^import okhttp3\.ConnectionPool$/gm).length, 1);
});

test('the plugin is registered in the app config', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'app.json'), 'utf8'));
  assert.ok(appJson.expo.plugins.includes('./plugins/with-android-okhttp-health'));
});
