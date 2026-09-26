# 构建产物规范

## 固定入口

- `npm run release`：完整生产构建并整理到 `out/latest/`。日常只从这里启动 `Vibe Remote Buddy.exe`，复制时复制整个目录。
- `npm run firmware:build`：从公开固件子模块编译并生成 `build/firmware-from-source/latest/` 完整安装包；`npm run release:from-source` 使用该源码构建包生成 App 成品。带 `:latest` 的对应命令会先更新子模块，正式发布前提交更新后的指针。
- `npm run installer`：把 `out/distribution/files` 的干净发行包打成 Windows NSIS 安装程序，固定输出 `out/distribution/vibe-remote-buddy-app-<版本>-<提交前8位>-<channel>[-dirty]-windows-x64-setup.exe`，附 `.sha256`。只打包 build-info 清单内文件并逐一核对散列；本地新增的机型不会进入安装包。需要 NSIS 3（`winget install NSIS.NSIS`，可用 BUDDY_NSIS_EXE 指定 makensis 路径）。
- `npm run release:archive`：完整构建，同时在 `out/releases/` 留一份不可覆盖的包目录。
- 归档名：`vibe-remote-buddy-app-<应用版本>-windows-<架构>-<UTC时间>-<提交前8位>[-dirty]`。压缩或对外发布时沿用该目录名，不另起名字。
- 应用版本默认来自 package.json，打包可用 BUDDY_APP_VERSION 覆盖；编译前生成的统一 build-info 注入关于页、Tauri 和成品。不能拿固件版本给应用命名。
- 每份包包含 `build-info.json`：版本、提交、工作区是否修改、打包时间、平台和文件 SHA256。时间是打包时间，不冒充编译时间。

`src-tauri/target/`、`dist/` 是构建缓存，`build/` 是测试、日志和临时诊断资料，不是给用户的启动入口。禁止创建 `fixed`、`new`、`probe-080` 等随意命名的交付目录。调试资料使用 `build/diagnostics/<YYYYMMDD-HHMMSS>-<主题>/`。

## 操作约束

构建必须启用 custom-protocol，嵌入前端，禁止把依赖 localhost 的开发程序交付用户。不要单独拷贝 EXE；资源、许可证与构建信息必须一起提供。更新 latest 前退出正在运行的该目录程序；占用导致替换失败时应保留原包并报错，不换个名字绕过。

默认构建只更新 latest，不积累历史版本。归档须明确需要；历史 build 内的旧产物不自动删除，人工核实后归档或清理。`.staging` / `.previous` 是打包事务临时目录，存在时先检查上次操作，不得直接当成新版本启动。

通过 `node scripts/package.mjs --import-existing <旧目录>` 可迁移已验证的旧包到固定入口；其原构建版本和提交记为 unknown，不能把当前源码提交冒充旧包来源。此选项只用于历史整理，不替代构建。

Windows 与 macOS 分别有打包脚本并经过验证；新增平台需要先扩展打包脚本并验证，不能把一个平台的包改名为另一个平台的包。公开应用仓库仅允许 receiver-firmware 下的固件发布产物及必要声明，不得混入内部源码或 SDK。


Windows 便携包还包含 `resources/installer/`：独立烧录助手、运行库、许可证及源码。默认使用 receiver-firmware 中经校验的三个板型发布镜像；BUDDY_FIRMWARE_DIR 可显式覆盖。每次打包重新用选定机型库生成 catalog.bin 并更新安装清单。缺失任何必需镜像或散列不符会失败，不生成缺功能的发行包。禁止单独发布助手 EXE 或删除其 _internal 目录。正式构建需要 Python，终端用户不需要。

NSIS 安装程序为按用户安装：默认装到 `%LOCALAPPDATA%\Programs\Vibe Remote Buddy`，只写 HKCU 注册表和当前用户快捷方式，普通用户全程不触发 UAC。界面 11 种语言（英/简中/繁中/日/韩/德/法/西/意/俄/巴西葡语），按系统语言预选、可切换并记住选择；静默安装 `/S` 默认英语，`/D=<目录>` 可指定目录且必须是最后一个参数。安装界面禁止选择磁盘根目录；卸载只删除打包清单内的文件及空目录，即使指定到已有目录也不会递归清空它。`resources\remotes` 下带 `user-edited` 标记的本地改编型号始终保留；设置与覆盖数据在 app_config_dir，不在卸载范围内。

构建与 GitHub 发版详见 [release-pipeline.md](release-pipeline.md)。

## macOS

- `npm run release:macos`（仅在 macOS 上）：与 `npm run release` 共用输入准备（机型库、固件、build-info），生成 `out/latest/Vibe Remote Buddy.app` 与 `out/latest/build-info.json`，以及 `out/distribution/vibe-remote-buddy-app-<版本>-<提交前8位>-<channel>[-dirty]-macos-<架构>.dmg` 和 `.sha256`。`--offline` 与 Windows 相同；`--no-notarize` 只签名不公证。
- 签名：`BUDDY_MAC_SIGN_IDENTITY` 为 Developer ID Application 证书名；`-` 表示 ad hoc 签名，仅供本机或 PR 测试，不会公证。应用包内每个 Mach-O（含初始化助手）都以 hardened runtime 签名；应用授权见 `src-tauri/macos/*.entitlements`，Info.plist 补充见 `src-tauri/Info.plist`。
- `npm run release:macos:from-source`：先从 `firmware/` 子模块编译固件，再用它打包，要求同 `npm run firmware:build`。在 macOS 上需要先 source ESP-IDF 5.4 的 `export.sh`，使 `IDF_PATH` 生效（固件构建工具在非 Windows 平台会检查这一点）。默认的 `npm run release:macos` 仍使用 `receiver-firmware/`，不需要 ESP-IDF。
- 公证：`BUDDY_NOTARY_PROFILE`（`xcrun notarytool store-credentials` 保存的钥匙串配置）或 `BUDDY_NOTARY_KEY` / `BUDDY_NOTARY_KEY_ID` / `BUDDY_NOTARY_ISSUER`（App Store Connect API 密钥）。公证后对 DMG 与应用 staple，并用 `spctl` 核验。
- 资源在 `Contents/Resources/resources/`，包含机型、机型库、初始化助手（PyInstaller 单文件，避免 Tauri 复制资源时展开 onedir 的框架符号链接而破坏签名）、固件镜像及 `docs/` 下的说明和许可证。不要在签名后修改应用包；用户改编的型号保存在应用数据目录。
- 在较新的 macOS 上，strip 后的 release proc-macro 动态库会被 dyld 拒绝加载，脚本为构建期依赖设置 `CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=false`，不影响最终应用。
