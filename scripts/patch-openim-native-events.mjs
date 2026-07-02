import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgePath = path.join(
  root,
  'node_modules/@openim/rn-client-sdk/ios/OpenImSdkRn.m',
);

// 这是一个 iOS-only 的原生桥硬化补丁。作为 postinstall 运行时，任何失败都**绝不能**
// 阻断 `npm install` / `npm ci` / EAS —— 否则 Android/web 构建、CI 全都会被一个只对
// iOS 有意义的 patch 拖垮。因此除「参数明确要求严格」外，一律以 exit 0 收尾并告警。
const strict = process.argv.includes('--strict') || process.env.PATCH_OPENIM_STRICT === '1';

function readSdkVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(root, 'node_modules/@openim/rn-client-sdk/package.json'),
        'utf8',
      ),
    );
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// 补丁不成功时的统一收尾：strict 下才真正 fail，正常安装流程仅告警放行。
function skip(reason) {
  const level = strict ? 'error' : 'warn';
  console[level](
    `[patch-openim] SKIPPED (sdk=${readSdkVersion()}): ${reason}. ` +
      `iOS native event hardening NOT applied; re-run pod install after resolving.`,
  );
  process.exit(strict ? 1 : 0);
}

if (!fs.existsSync(bridgePath)) {
  // 缺文件是常态（Android/web-only 安装、未装 iOS 依赖），安静跳过。
  console.warn('[patch-openim] OpenImSdkRn.m not found; skipping (non-iOS install?)');
  process.exit(0);
}

const helper = `static id RCTOpenIMSafeEventBodyWithDepth(id value, NSUInteger depth);

static id RCTOpenIMSafeEventBody(id value) {
    if (value == nil) {
        return @{};
    }

    return RCTOpenIMSafeEventBodyWithDepth(value, 0) ?: @{};
}

static id RCTOpenIMSafeEventBodyWithDepth(id value, NSUInteger depth) {
    if (value == nil) {
        return [NSNull null];
    }

    if (value == (id)kCFNull || [value isKindOfClass:[NSNull class]]) {
        return [NSNull null];
    }

    if ([value isKindOfClass:[NSString class]] || [value isKindOfClass:[NSNumber class]]) {
        return value;
    }

    if (depth >= 20) {
        return [value description] ?: @"";
    }

    if ([value isKindOfClass:[NSDictionary class]]) {
        NSDictionary *dictionary = (NSDictionary *)value;
        NSMutableDictionary *safeDictionary = [NSMutableDictionary dictionaryWithCapacity:dictionary.count];
        for (id key in dictionary) {
            id safeKey = [key isKindOfClass:[NSString class]] ? key : [key description];
            if (safeKey == nil) {
                continue;
            }

            id safeValue = RCTOpenIMSafeEventBodyWithDepth([dictionary objectForKey:key], depth + 1);
            [safeDictionary setObject:(safeValue ?: [NSNull null]) forKey:safeKey];
        }

        return [safeDictionary copy];
    }

    if ([value isKindOfClass:[NSArray class]]) {
        NSArray *array = (NSArray *)value;
        NSMutableArray *safeArray = [NSMutableArray arrayWithCapacity:array.count];
        for (id item in array) {
            id safeItem = RCTOpenIMSafeEventBodyWithDepth(item, depth + 1);
            [safeArray addObject:(safeItem ?: [NSNull null])];
        }

        return [safeArray copy];
    }

    return [value description] ?: @"";
}`;

const pushEvent = `- (NSSet<NSString *> *)supportedOpenIMEvents {
    static NSSet<NSString *> *supportedOpenIMEvents = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        supportedOpenIMEvents = [NSSet setWithArray:[self supportedEvents]];
    });
    return supportedOpenIMEvents;
}

- (void)pushEvent:(NSString *)eventName data:(id)data {
    if (![eventName isKindOfClass:[NSString class]] || eventName.length == 0) {
        NSLog(@"[OpenIMSDKRN] Dropped event with invalid name: %@", eventName);
        return;
    }

    NSString *safeEventName = [eventName copy];
    if (![[self supportedOpenIMEvents] containsObject:safeEventName]) {
        NSLog(@"[OpenIMSDKRN] Dropped unsupported event: %@", safeEventName);
        return;
    }

    if (!hasListeners) {
        return;
    }

    id safeBody = RCTOpenIMSafeEventBody(data);
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!hasListeners) {
            return;
        }

        @try {
            [self sendEventWithName:safeEventName body:(safeBody ?: @{})];
        } @catch (NSException *exception) {
            NSLog(@"[OpenIMSDKRN] Dropped event %@ after React Native rejected it: %@", safeEventName, exception.reason);
        }
    });
}`;

const parseJsonStr2Dict = `- (NSDictionary *)parseJsonStr2Dict:(NSString *)jsonStr {
    if (![jsonStr isKindOfClass:[NSString class]] || jsonStr.length == 0) {
        return @{};
    }

    NSData *jsonData = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    if (jsonData == nil) {
        return @{};
    }

    NSError *error = nil;
    id jsonObject = [NSJSONSerialization JSONObjectWithData:jsonData options:NSJSONReadingFragmentsAllowed error:&error];
    if (error || ![jsonObject isKindOfClass:[NSDictionary class]]) {
        NSLog(@"Error while parsing JSON dictionary: %@", error.localizedDescription ?: @"Invalid root type");
        return @{};
    }

    return (NSDictionary *)jsonObject;
}`;

const parseJsonStr2Array = `- (NSArray *)parseJsonStr2Array:(NSString *)jsonStr {
    if (![jsonStr isKindOfClass:[NSString class]] || jsonStr.length == 0) {
        return @[];
    }

    NSData *jsonData = [jsonStr dataUsingEncoding:NSUTF8StringEncoding];
    if (jsonData == nil) {
        return @[];
    }

    NSError *error = nil;
    id jsonObject = [NSJSONSerialization JSONObjectWithData:jsonData options:NSJSONReadingFragmentsAllowed error:&error];
    if (error || ![jsonObject isKindOfClass:[NSArray class]]) {
        NSLog(@"Error while parsing JSON array: %@", error.localizedDescription ?: @"Invalid root type");
        return @[];
    }

    return (NSArray *)jsonObject;
}`;

function insertHelper(src) {
  if (src.includes('RCTOpenIMSafeEventBodyWithDepth')) {
    return src;
  }

  const marker = '@implementation OpenIMSDKRN';
  if (!src.includes(marker)) {
    throw new Error('OpenIM bridge implementation marker not found');
  }

  return src.replace(marker, `${helper}\n\n${marker}`);
}

function ensureSupportedEvents(src) {
  const supportedStart = src.indexOf('supportedEvents');
  const supportedEnd = src.indexOf('startObserving', supportedStart);
  if (supportedStart === -1 || supportedEnd === -1) {
    throw new Error('OpenIM supportedEvents block not found');
  }

  const supportedEvents = src.slice(supportedStart, supportedEnd);
  if (
    supportedEvents.includes('@"onUserCommandAdd"') &&
    supportedEvents.includes('@"onUserCommandDelete"') &&
    supportedEvents.includes('@"onUserCommandUpdate"')
  ) {
    return src;
  }

  const marker = '  @"onUserStatusChanged",\n';
  if (!src.includes(marker)) {
    throw new Error('OpenIM supportedEvents user-status marker not found');
  }

  let next = src;
  for (const eventName of [
    'onUserCommandAdd',
    'onUserCommandDelete',
    'onUserCommandUpdate',
  ]) {
    next = next.replace(new RegExp(`\\n\\s*@"${eventName}",`, 'g'), '');
  }

  return next.replace(
    marker,
    `${marker}  @"onUserCommandAdd",\n  @"onUserCommandDelete",\n  @"onUserCommandUpdate",\n`,
  );
}

function replaceBetween(src, start, end, replacement) {
  const startIndex = src.indexOf(start);
  if (startIndex === -1) {
    throw new Error(`OpenIM bridge start marker not found: ${start}`);
  }

  const endIndex = src.indexOf(end, startIndex + start.length);
  if (endIndex === -1) {
    throw new Error(`OpenIM bridge end marker not found: ${end}`);
  }

  return `${src.slice(0, startIndex)}${replacement}\n\n${src.slice(endIndex)}`;
}

function removeExistingSupportedOpenIMEventMethods(src) {
  const start = '- (NSSet<NSString *> *)supportedOpenIMEvents {';
  let next = src;
  let startIndex = next.indexOf(start);

  while (startIndex !== -1) {
    const nextMethodPattern = /\n- \(/g;
    nextMethodPattern.lastIndex = startIndex + start.length;
    const nextMethod = nextMethodPattern.exec(next);
    if (!nextMethod) {
      throw new Error('OpenIM supportedOpenIMEvents method end not found');
    }

    const removeStart =
      startIndex > 0 && next[startIndex - 1] === '\n'
        ? startIndex - 1
        : startIndex;
    next = `${next.slice(0, removeStart)}${next.slice(nextMethod.index)}`;
    startIndex = next.indexOf(start);
  }

  return next;
}

try {
  const source = fs.readFileSync(bridgePath, 'utf8');
  let next = insertHelper(source);
  next = ensureSupportedEvents(next);
  next = removeExistingSupportedOpenIMEventMethods(next);
  next = replaceBetween(
    next,
    '- (void)pushEvent:(NSString *)eventName data:(id)data {',
    '- (NSDictionary *)parseJsonStr2Dict:',
    pushEvent,
  );
  next = replaceBetween(
    next,
    '- (NSDictionary *)parseJsonStr2Dict:',
    '- (NSArray *)parseJsonStr2Array:',
    parseJsonStr2Dict,
  );
  next = replaceBetween(
    next,
    '- (NSArray *)parseJsonStr2Array:',
    'RCT_EXPORT_METHOD(initSDK:',
    parseJsonStr2Array,
  );

  if (next === source) {
    console.log('[patch-openim] OpenIM native event hardening already applied');
    process.exit(0);
  }

  fs.writeFileSync(bridgePath, next);
  console.log('[patch-openim] OpenIM native event hardening applied');
} catch (error) {
  // marker 变动（多因 SDK 升级）会走到这里。绝不 fail 整个安装：仅告警放行，
  // 需要在 CI 的 iOS 构建前用 `--strict` 或 PATCH_OPENIM_STRICT=1 强校验。
  skip(error.message);
}
