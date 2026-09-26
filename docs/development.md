# 开发与构建

这里集中说明 App 仓库的开发环境、构建和技术边界。普通使用步骤见[图文使用说明](user-guide.md)。App 源码采用 MIT 许可证；[固件源码](https://github.com/kxn/vibe-remote-buddy-firmware)在独立仓库，`receiver-firmware/` 存放 App 发行包使用的固件二进制、校验清单和第三方声明。

## 工程结构

- `src/core/`：管理协议、会话、设备、配置和动作模型。
- `src/action-runner.ts`：需要桌面应用运行的软件动作。
- `src-tauri/src/`：串口、文件、托盘和平台接口。
- `resources/remotes/`：可编辑的遥控器外观与资源；正式机型知识库在 `resources/catalog/`。
- `receiver-firmware/`：公开发布镜像及安装清单，不含固件源码。
- `firmware/`：独立公开固件仓库的子模块，可与 App 源码一起修改并分别提交 PR。

音频和标准键盘输入由接收器通过 USB 麦克风与 HID 提供。桌面应用管理设备和执行软件动作，不处理蓝牙协议、语音解码或识别。管理通道使用 Buddy v1 / RBP/3；旧 CH582 客户端和普通蓝牙适配器不兼容。一个接收器最多保存两只遥控器。

## 开发环境

Windows 需要 Python 3.13、Node.js 22、Rust stable、Windows C++ 构建工具及 WebView2；macOS 需要 Xcode 命令行工具、Python 3、Node.js 22 和 Rust stable。系统依赖见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

```powershell
git clone https://github.com/kxn/vibe-remote-buddy-app.git
cd vibe-remote-buddy-app
npm ci
npm run tauri -- dev
```

目前经过完整构建和实机验证的平台是 Windows 和 macOS（Apple 芯片）。Linux 的平台实现仍在开发中；各平台的窗口聚焦、窗口选择器和输入法切换分别实现，不能互相套用。微信输入法的实际切换还需要在装有该输入法的机器上验证。平台实现见[平台边界](platforms.md)。

## 测试

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

可选 UI 测试需要 Python、Playwright 和 Microsoft Edge。先在另一终端运行 `npm run dev`：

```powershell
python -m pip install -r tests/requirements.txt
python tests/ui_check.py
python tests/actions_ui_check.py
```

UI 测试使用模拟接口，不连接真实接收器。原生窗口测试会改变前台窗口；标记为 ignored 的输入法实机测试默认不执行。

使用说明中的界面图由应用页面配合示例设备数据生成。运行 `npm run dev` 后，可用 `python scripts/capture-user-guide.py` 按 2 倍像素重拍；截图不代表实机功能验收。

## 构建与发布

正式构建使用 `npm run release`，固定输出为 `out/latest/`。它嵌入前端并启用 `custom-protocol`；普通 `cargo build --release` 不能作为交付包。便携包必须保留 EXE 旁边的 `resources/`、许可证、清单和说明书。验收打包后的应用时，先停止占用 1420 端口的 Vite 开发服务。

`npm run installer` 用已校验的发行包制作按用户安装的 NSIS 安装程序；`npm run release:archive` 留存不可覆盖的归档。每份包的 `build-info.json` 记录版本、来源和文件校验值。应用、固件与机型库各有独立版本。离线构建可显式使用 `npm run release:offline`；在线构建要求锁定并校验最新机型库，网络失败会停止。

已安装 ESP-IDF 5.4.0 且设置 `IDF_PATH` 后，可在 App 仓库直接运行 `npm run firmware:build`。脚本自动初始化 `firmware/` 子模块，编译三种板型，并在 `build/firmware-from-source/latest/` 生成经校验的完整固件安装包。`npm run release:from-source` 在构建 App 前执行同一流程，并把新固件放进 App 成品。macOS 可用 `npm run release:macos:from-source`。首次编译需要联网下载并校验 ITU 数值表；已有官方 ZIP 可通过 `BUDDY_ITU_G7221_ARCHIVE` 指定。

上述命令默认使用 App 仓库固定的固件提交。需要拉取公开固件仓库 `main` 最新提交时，运行 `npm run firmware:build:latest`，或 `npm run release:from-source:latest`。更新后 App 的子模块指针会改变；请审查并提交该指针，正式发布使用固定提交以便复现。开发固件时可直接在 `firmware/` 修改、提交并向固件仓库发 PR；App 的集成改动向本仓库发 PR。两边改动有关联时，在 PR 描述中互相链接；等固件 PR 合并到公开仓库后，再更新 App 的子模块指针，避免 App CI 无法从固件仓库取得仅存在于贡献者 fork 的提交。已有的 `receiver-firmware/` 保留为无需 ESP-IDF 的默认 App 构建输入；审查新镜像后，运行 `npm run firmware:import:source` 可更新该目录。

推送到 `main` 或提交 PR 只触发 CI 构建与测试。GitHub Actions 的手动发布和 `vX.Y.Z` 标签才进入正式发布流程。具体规则见[构建产物规范](build-artifacts.md)和[发布设计](release-pipeline.md)。当前 Windows 安装包没有代码签名。macOS 使用 `npm run release:macos` 生成签名的 `out/latest/Vibe Remote Buddy.app` 和公证后的 DMG，签名与公证参数见[构建产物规范](build-artifacts.md#macos)。

## 接收器与机型资源

添加窗口只显示支持的型号或已绑定身份，要求信号强度至少 −65 dBm，且最近 5 秒收到广播。型号名称只用于发现候选；连接后还要核对设备指纹与协议。多只同名设备、取消和重试的处理见[设备生命周期](device-lifecycle.md)。

`resources/remotes/` 提供外观、布局和可编辑默认功能；同协议变种可通过资源配置接入，协议不同则需要固件驱动支持。详见[型号资源](remote-models.md)和[遥控器适配工具](remote-probe.md)。用户配置可能包含本机程序路径；导入后，软件动作需要重新保存授权。不要公开上传用户备份或诊断日志。

首次安装接收器需要完整且经校验的镜像包。安装器检查 ESP32-S3、Flash、PSRAM 和安全状态，再选对应的 q2、o8 或 q2-f4 镜像；初始化会擦除原程序与数据，普通更新保留配置。源码构建使用公开 `firmware/` 子模块，不依赖内部仓库。实现细节见[首次安装](receiver-setup-implementation.md)和[固件更新](firmware-update.md)。

## 深入阅读

- [客户端协议](protocol.md)
- [按键动作与输入法](actions.md)
- [平台接口](platforms.md)
- [机型库设计](model-catalog-design.md)
- [UI 规范](ui-guidelines.md)
- [第三方声明](../THIRD_PARTY_NOTICES.md)
