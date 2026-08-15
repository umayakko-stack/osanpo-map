// Androidアプリ版専用: @capacitor/coreランタイムをバンドルし、
// プラグインを登録して window.__BgGeo / window.__CapCore として公開する。
// （native-bridge.jsにはregisterPluginが無いため、バンドルが必須）
// web版で読み込まれても無害（isNativePlatform()がfalseになるだけ）。
import { Capacitor, registerPlugin } from "@capacitor/core";
window.__CapCore = Capacitor;
window.__BgGeo = registerPlugin("BackgroundGeolocation");
window.__Battery = registerPlugin("Battery"); // バッテリー最適化除外（MainActivityで登録するローカルプラグイン）
