# 图标资源

- icon.svg：应用主图形，主体放大、减少留白；public/icon.svg 为界面副本。
- tray.svg：小尺寸专用版本，去掉波纹，增加主体占比。
- icon.ico：16/20/24/32/40/48/64/96/128/256 px；32 px 及以下使用简化版本。
- tray-*.png：16/20/24/32/40/48/64 px；按 Windows 任务栏窗口 DPI 选择，主窗口 DPI 变化时重新检查。
- tray-template.svg / tray-template.png（44 px）：macOS 菜单栏模板图像，黑色轮廓加透明镂空，由系统按菜单栏外观着色。
- icon.png / icon.icns：大尺寸及 macOS 资源。

SVG 用 Tauri CLI 的 icon 命令栅格化；通过 --png 参数指定小尺寸。ICO 为各尺寸分别嵌入 PNG 帧，不能只替换一张大图。所有图片保留透明圆角。

Windows 依据：
https://learn.microsoft.com/zh-cn/windows/apps/design/iconography/app-icon-construction
https://learn.microsoft.com/en-us/windows/win32/shell/notification-area

注意：Tauri 2 当前 ICO 解码器仅取第一帧，ICO 必须以 256px 帧开头。主窗口还显式设置 256px PNG，避免任务栏将 16px 小图放大。不要将帧顺序改成从小到大。
