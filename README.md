# Vibe Remote Buddy App

遥控器接收器的桌面管理应用，使用 Tauri 2、React 和 TypeScript。可管理多只遥控器、配置按键，以及用遥控器切换应用和聚焦输入框。

应用源码采用 **MIT** 许可证，欢迎修改和二次开发。接收器固件独立维护，**不包含在本仓库**。

## 功能

- 管理最多 4 只遥控器：扫描、手动选择配对、重新配对、解绑与重命名。
- 小米和联通遥控器布局，每只设备独立配置按键、快捷键、媒体键和软件动作。
- 语音预设：豆包、微信的默认快捷键随接收器识别的主机类型调整（需要 voice_presets=1 固件）；自定义组合键保持原值。Windows 默认右 Alt / Ctrl+Win；macOS Fn 仍待实机验证。
- Windows 应用切换、指定输入框聚焦、窗口选择器及窗口/桌面操作。
- 切到指定应用后，跟随触发遥控器的语音预设切换输入法并请求中文状态。Windows 使用桌面会话范围切换，其他窗口的输入法也可能改变；未配置或自定义组合不切换。
- 托盘、开机启动、本机配置备份/恢复、设备状态与诊断。

音频和标准键盘输入由接收器通过 USB 麦克风/HID 提供，应用不处理 ASR、蓝牙协议或音频解码。关闭应用后，板端保存的标准按键和语音功能仍可工作；软件动作需要应用运行。

## 兼容性

需要运行 **Buddy v1 / RBP/3 JSON 管理协议** 的 Vibe Remote Buddy 接收器。该接口不同于旧 CH582 客户端，不能把任意蓝牙适配器或旧固件当作兼容设备。仅有本仓库不能制作或烧录接收器；当前不提供接收器固件下载。

目前实际验证平台为 **Windows**。macOS/Linux 保留共享界面及部分平台实现，尚未完成构建和功能验证；Windows 的窗口聚焦、选择器、输入法切换不承诺跨平台可用。微信实际切换还需在安装该输入法的机器上验证。

## 开发与构建

安装 Node.js 22、Rust stable、Windows C++ 构建工具及 WebView2。环境准备参见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

```powershell
git clone https://github.com/kxn/vibe-remote-buddy-app.git
cd vibe-remote-buddy-app
npm ci
npm run tauri -- dev
```

构建优化版独立可执行文件：

```powershell
npm run tauri -- build --no-bundle
```

Windows 输出为 src-tauri/target/release/vibe-remote-buddy.exe。目前不生成安装包，也未做代码签名。开发构建可加 --debug。

## 测试

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

可选 UI 测试需要 Python、Playwright 和 Microsoft Edge；先在另一终端运行 npm run dev：

```powershell
python -m pip install -r tests/requirements.txt
python tests/ui_check.py
python tests/actions_ui_check.py
```

UI 测试注入模拟接口，不连接真实接收器。原生窗口测试会改变前台窗口；Rust 的 live_switch_from_weasel 为显式忽略的实机测试，会切换输入法，默认不执行。

## 代码与协议

- src/core：与 UI 无关的帧协议、会话、设备管理、配置与动作模型。
- src/action-runner.ts：应用动作编排。
- src-tauri/src：串口、文件、托盘及原生平台操作。
- [客户端协议](docs/protocol.md)
- [应用动作与输入法行为](docs/actions.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

添加列表仅显示支持型号或已绑定身份，并要求 RSSI ≥ -65 dBm、5 秒内收到广播。窗口打开时持续搜索；信号门槛是近距离筛选，不是精确测距。配对前先停止扫描，防止旧候选编号被复用。

用户配置包含本机应用路径和自定义动作，请勿直接上传配置备份或诊断日志。导入配置不会自动获得执行权限，需要重新保存对应软件动作。
