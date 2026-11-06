const { withMainApplication } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

// RN 默认的 OkHttp 没有 HTTP/2 心跳，连接池空闲 5 分钟才回收。手机切网、回到前台或 NAT
// 映射过期后，半死的连接会被继续复用：请求写进去没有回音，只能等 JS 的超时，而下一个请求
// 还会复用同一条连接（2026-11 安卓 14 天 225 次超时，成批出现在回前台的那一批请求）。
// - pingInterval 5s：上一次心跳没回音就判死，挂在上面的请求立刻失败（JS 侧 GET 会重试），
//   连接被移出池子，后面的请求走新连接。
// - 空闲 30s 回收：在后台待过一会儿回来，直接建新连接；也让进后台后的心跳很快停下。
// 只能从 RN 自己的 builder 起步：它带 ReactCookieJarContainer（NetworkingModule 会强转）
// 和磁盘缓存。
const IMPORTS = [
  'import com.facebook.react.modules.network.OkHttpClientProvider',
  'import java.util.concurrent.TimeUnit',
  'import okhttp3.ConnectionPool',
];

const FACTORY = [
  '    val httpConnectionPool = ConnectionPool(5, 30, TimeUnit.SECONDS)',
  '    OkHttpClientProvider.setOkHttpClientFactory {',
  '      OkHttpClientProvider.createClientBuilder(applicationContext)',
  '        .connectionPool(httpConnectionPool)',
  '        .pingInterval(5, TimeUnit.SECONDS)',
  '        .build()',
  '    }',
].join('\n');

module.exports = function withAndroidOkHttpHealth(config) {
  return withMainApplication(config, (mod) => {
    if (mod.modResults.language !== 'kt') {
      throw new Error('with-android-okhttp-health expects a Kotlin MainApplication');
    }
    let contents = mergeContents({
      src: mod.modResults.contents,
      tag: 'windnote-okhttp-health-imports',
      anchor: /^import android\.content\.res\.Configuration$/,
      offset: 1,
      comment: '//',
      newSrc: IMPORTS.join('\n'),
    }).contents;
    contents = mergeContents({
      src: contents,
      tag: 'windnote-okhttp-health',
      anchor: /super\.onCreate\(\)/,
      offset: 1,
      comment: '    //',
      newSrc: FACTORY,
    }).contents;
    mod.modResults.contents = contents;
    return mod;
  });
};
