# Vibe Remote Buddy App

遥控器接收器的桌面管理应用，使用 Tauri 2、React 和 TypeScript。可管理多只遥控器、配置按键，以及用遥控器切换应用和聚焦输入框。

应用源码采用 **MIT** 许可证，欢迎修改和二次开发。接收器固件源码独立维护；`receiver-firmware/` 存放发布二进制、校验清单及第三方声明。

## 功能

- 每个接收器管理最多 2 只遥控器：扫描、手动选择配对、重新配对、解绑与重命名。
- 小米和联通遥控器布局，每只设备独立配置按键、快捷键、媒体键和软件动作。
- 语音预设：豆包、微信的默认快捷键随接收器识别的主机类型调整（需要 voice_presets=1 固件）；自定义组合键保持原值。Windows 默认右 Alt / Ctrl+Win；macOS Fn 仍待实机验证。
- Windows 应用切换、指定输入框聚焦、窗口选择器及窗口/桌面操作。
- 切到指定应用后，跟随触发遥控器的语音预设切换输入法并请求中文状态。Windows 使用桌面会话范围切换，其他窗口的输入法也可能改变；未配置或自定义组合不切换。
- 托盘、开机启动、本机配置备份/恢复与设备状态。

音频和标准键盘输入由接收器通过 USB 麦克风/HID 提供，应用不处理 ASR、蓝牙协议或音频解码。关闭应用后，板端保存的标准按键和语音功能仍可工作；软件动作需要应用运行。

## 兼容性

需要运行 **Buddy v1 / RBP/3 JSON 管理协议** 的 Vibe Remote Buddy 接收器。该接口不同于旧 CH582 客户端，不能把任意蓝牙适配器或旧固件当作兼容设备。完整便携包包含三个板型的首次安装镜像、固件升级包及最新机型库，可离线初始化接收器。

目前实际验证平台为 **Windows**。macOS/Linux 保留共享界面及部分平台实现，尚未完成构建和功能验证；Windows 的窗口聚焦、选择器、输入法切换不承诺跨平台可用。微信实际切换还需在安装该输入法的机器上验证。

## 开发与构建

安装 Python 3.13、Node.js 22、Rust stable、Windows C++ 构建工具及 WebView2。环境准备参见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

```powershell
git clone https://github.com/kxn/vibe-remote-buddy-app.git
cd vibe-remote-buddy-app
npm ci
npm run tauri -- dev
```

构建优化版独立可执行文件：

```powershell
npm run release
```

Windows 完整便携包固定输出到 `out/latest/`，启动其中的 `Vibe Remote Buddy.exe`。`npm run installer` 可从经校验的发行包生成按用户安装的 NSIS 安装程序。需要留档使用 `npm run release:archive`。每份包带 `build-info.json`，详见[构建产物规范](docs/build-artifacts.md)。目前未做代码签名。

给最终用户的操作步骤见[使用说明](docs/user-guide.md)，便携包内也附有 `USER-GUIDE.md`。

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
- [固件更新与发布打包](docs/firmware-update.md)
- [应用动作与输入法行为](docs/actions.md)
- [平台接口与适配范围](docs/platforms.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

添加列表仅显示支持型号或已绑定身份，并要求 RSSI ≥ -65 dBm、5 秒内收到广播。窗口打开时持续搜索；信号门槛是近距离筛选，不是精确测距。配对前先停止扫描，防止旧候选编号被复用。

用户配置包含本机应用路径和自定义动作，请勿直接上传配置备份或诊断日志。导入配置不会自动获得执行权限，需要重新保存对应软件动作。

## 型号资源

型号识别、按钮默认功能、布局和外观位于 `resources/remotes`。同协议变种可以编辑资源后安装到接收器，无需重编译；发布时必须同时提供 exe 和资源目录。详见 [型号资源说明](docs/remote-models.md)。

适配同协议的新遥控器，可使用[遥控器适配工具](docs/remote-probe.md)采集身份、按键与布局资源。

正式构建统一使用 `npm run release`，会编译前端并启用 `custom-protocol`，将页面嵌入 EXE。不要用普通 `cargo build --release` 打发布包；构建检查会拒绝缺少生产资源特性的 release。便携包必须同时包含 EXE 和旁边的 `resources` 目录。验收时停止 Vite（1420 端口），再启动打包后的 EXE。


## 初始化新接收器（Windows）

未连接接收器时，发现 USB 开发板候选会出现“初始化接收器”；也可从设置 → 高级进入。候选不是兼容性结论，选定后才连接检查。自动连接失败时按 BOOT 提示操作。

安装需要应用随附完整固件包。公开源码可独立构建，不包含私有固件；缺少安装包时禁止擦写。检查 S3、8/16 MB Quad Flash 和安全状态；2 MB Quad 或 8 MB Octal PSRAM 自动选择对应固件。无法识别外置 PSRAM 时，需要根据板型选择规格并明确确认。初始化清除全部原程序和数据，必须勾选确认；正常升级仍使用保留数据的原升级入口。

`npm run release` 会构建独立 esptool 助手（首次需联网下载锁定版本依赖）；使用者无需安装 Python 或 ESP-IDF。必须复制整个 `out/latest`，包括 `resources/installer`。当前仅完成自动化验证，首次擦写和不同 USB 接口的真机行为仍需实际验收。


0.12.0 起支持 ESP32-S3 SuperMini 的 4 MB Quad Flash + 2 MB Quad PSRAM（`s3-q2-f4-ab2`）。8/16 MB q2/o8 原目标保持原分区。各目标均保留双应用、双配置与双机型库；首次安装按实测容量选包，包含离线机型库。不能在普通 OTA 中交叉刷写不同分区目标。

## 版本与发布

“设置 → 关于”显示构建版本，例如 `0.1.0+1234abcd`，未提交修改的本地构建带 `.dirty`。App 版本默认来自 package.json，可在打包时用 `BUDDY_APP_VERSION` 指定；固件与机型库保留各自版本。

`npm run release` 锁定机型库 main 的最新提交并下载校验，重新编译随固件安装的机型数据库，再生成完整包。网络失败会停止，不静默退回旧库。离线构建可显式使用 `npm run release:offline`。

GitHub Actions 的 Windows build 支持手动构建，可输入版本号并勾选 publish 发版；推送 `vX.Y.Z` 标签也会发布。普通 main/PR 构建仅生成测试通过的 ZIP artifact。详细机制见 [发布设计](docs/release-pipeline.md)。

首页标题下和关于页均显示构建版本，例如 `0.1.4+abcd1234.release`。GitHub 正式发行标记 `release`，普通 CI 构建标记 `ci`，本地构建始终标记 `local`；未提交修改另加 `.dirty`。ZIP 文件名包含相同来源标记。
