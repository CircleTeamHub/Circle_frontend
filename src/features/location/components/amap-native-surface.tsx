import { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * 高德原生地图载体。
 *
 * 为什么是原生 SDK 而不是网页版的地图 JS API：高德的计费表里，地图显示只对
 * JS 的「图面初始化」按次收费，Android / iOS 原生 SDK 那一栏根本不在计费项里。
 * 同一块地图，走原生就是零成本。
 *
 * 选点交互也跟着换了：这个库没有暴露地图点击和图钉拖拽事件，只有区域变化事件。
 * 于是改成图钉钉死在屏幕正中、用户拖动地图来选点 —— 也就是微信发位置的那套操作，
 * 国内用户更熟，单手也更好按。
 *
 * 坐标全程是 GCJ-02：高德认的就是这套，减偏交给调用方，这里一行换算都没有。
 */

type NativeMapRef = {
  setCenter?: (
    center: { latitude: number; longitude: number },
    animated?: boolean,
  ) => Promise<void>;
};

type NativeMapProps = {
  style: object;
  initialCameraPosition: {
    target: { latitude: number; longitude: number };
    zoom: number;
  };
  compassEnabled: boolean;
  onLoad: () => void;
  onCameraIdle: (event: {
    nativeEvent: {
      cameraPosition: {
        target?: { latitude: number; longitude: number };
      };
    };
  }) => void;
};

type AmapModule = {
  MapView: React.ForwardRefExoticComponent<
    NativeMapProps & React.RefAttributes<NativeMapRef>
  >;
  ExpoGaodeMapModule: {
    setPrivacyConfig: (config: {
      hasShow: boolean;
      hasContainsPrivacy: boolean;
      hasAgree: boolean;
      privacyVersion: string;
    }) => void;
  };
};

/**
 * 延迟加载：这个包在 Expo Go 里、或者装了依赖还没 prebuild 时没有对应的原生模块，
 * 顶层 import 会直接把整个选点页拖崩。拿不到就当没有，调用方会回落到网页地图。
 */
function loadAmapModule(): AmapModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('expo-gaode-map') as AmapModule;
    if (!loaded?.MapView || !loaded.ExpoGaodeMapModule?.setPrivacyConfig) {
      return null;
    }
    // 注册/使用服务前用户已确认本应用隐私政策；在首次触碰原生 SDK 前把同一状态
    // 同步给高德。版本变化会让 SDK 自己使旧同意失效，避免无意沿用过期授权。
    loaded.ExpoGaodeMapModule.setPrivacyConfig({
      hasShow: true,
      hasContainsPrivacy: true,
      hasAgree: true,
      privacyVersion: '2026-09',
    });
    return loaded;
  } catch {
    return null;
  }
}

const amapModule = loadAmapModule();

/** 这台设备上到底能不能用原生高德地图。 */
export const isAmapNativeSupported = amapModule !== null;

export type AmapNativeSurfaceRef = {
  /** 把地图中心移到指定坐标（GCJ-02）。 */
  setCenter: (latitude: number, longitude: number) => void;
};

export type AmapNativeSurfaceProps = {
  /** 初始中心点，GCJ-02。 */
  latitude: number;
  longitude: number;
  /** 图钉颜色，跟随主题。 */
  pinColor: string;
  /** 地图停下来之后的新中心点，GCJ-02。 */
  onCenterChanged: (latitude: number, longitude: number) => void;
  /** 地图画出来了，可以撤掉加载指示。 */
  onReady: () => void;
};

export const AmapNativeSurface = forwardRef<
  AmapNativeSurfaceRef,
  AmapNativeSurfaceProps
>(function AmapNativeSurface(
  { latitude, longitude, pinColor, onCenterChanged, onReady },
  ref,
) {
  const mapRef = useRef<NativeMapRef | null>(null);

  useImperativeHandle(ref, () => ({
    setCenter: (nextLatitude, nextLongitude) => {
      void mapRef.current?.setCenter?.(
        { latitude: nextLatitude, longitude: nextLongitude },
        true,
      );
    },
  }));

  if (!amapModule) return null;
  const { MapView } = amapModule;

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        style={s.map}
        // 非受控属性：挂载后再改不会让地图跳回去，正好符合「用户拖到哪算哪」。
        initialCameraPosition={{
          target: { latitude, longitude },
          zoom: 15,
        }}
        compassEnabled={false}
        onLoad={onReady}
        onCameraIdle={(event: {
          nativeEvent: {
            cameraPosition: {
              target?: { latitude: number; longitude: number };
            };
          };
        }) => {
          const target = event.nativeEvent.cameraPosition.target;
          if (target) onCenterChanged(target.latitude, target.longitude);
        }}
      />
      {/* 图钉钉死在正中：它标的就是地图中心，所以不接受任何触摸。 */}
      <View pointerEvents="none" style={s.pinLayer}>
        <Ionicons name="location" size={36} color={pinColor} />
      </View>
    </View>
  );
});

const s = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  pinLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    // 图钉的尖端在图标底部，往上抬半个身位才对准中心。
    paddingBottom: 36,
  },
});
