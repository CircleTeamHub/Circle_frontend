// 应用入口。React 渲染器加载时只读一次 DevTools 钩子，提交计数钩子必须排在
// expo-router/entry 前面装上（见 src/observability/react-commit-hook.ts）。
import './src/observability/install-react-commit-hook';
import 'expo-router/entry';
