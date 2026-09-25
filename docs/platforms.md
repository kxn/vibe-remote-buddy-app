# 平台边界

管理协议、配置、固件更新与 UI 不直接使用操作系统窗口句柄。

- `src-tauri/src/platform/types.rs`：稳定的窗口标识、输入框匹配条件和应用身份类型。token 对上层是不透明字符串。
- `platform/windows/`：Win32 窗口枚举与激活、UI Automation 聚焦、TSF/IMM 输入法切换、开始菜单应用目录、启动入口及托盘 DPI。原有前台身份校验和超时保留。
- `platform/macos/`：CGWindowList + NSRunningApplication 窗口枚举（token 为 `pid:窗口号`，路径为 app bundle，process 为 bundle id）、NSRunningApplication/AXFrontmost/AXRaise 激活并校验前台、AX 输入框聚焦、`.app` 目录扫描与 `open -b` 启动、Carbon TIS 输入法切换（主线程有界执行），应用文件仍用 `open -a`。详见 [actions.md](actions.md#macos)。不得调用 Win32 或按 Windows 包名识别 Mac 应用。
- `platform/unsupported.rs`：其他平台的明确失败返回。
- `src/platform/`：前端平台适配合同、Windows 应用身份与输入框规则、macOS bundle id 与 AX 名称规则。`inputProfiles` 随 `configurePlatform` 切换，两平台动作 ID 相同。启动管理会话前通过原生 `desktop_platform` 选择实现。核心动作模型仅使用稳定动作 ID。

macOS 适配不修改接收器协议。未获得辅助功能权限返回可识别错误并提示一次，不返回虚假的成功。不把 HWND/PID 或 WindowsApps 路径判断放回通用层。实机验证范围见 [actions.md](actions.md#macos)。

macOS 专有处理（均为 `cfg(target_os = "macos")`，Windows 行为不变）：

- 串口：macOS 为每个 USB 串口同时列出 `/dev/cu.*` 和 `/dev/tty.*`，只保留 callout 的 `cu.` 节点，否则一个接收器显示两次且不会自动连接。
- Fn 语音预设：固件按主机类型对 macOS 发送 Apple Top Case Fn（0x00FF/0x03），但 macOS 不接受非 Apple 键盘的这一用法。`platform/macos/fn_bridge.rs` 用 IOHIDManager 监听接收器（VID 0xCAFE / PID 0x4016）自己的 Fn 按下与松开，同步合成系统 Fn（flagsChanged，kVK_Function）。系统已识别 Fn 时不重复；接收器拔出时释放 Fn。需要“输入监控”（读取接收器键盘）和“辅助功能”（发送按键）权限。
- 资源：打包资源在 `Contents/Resources/resources/`；初始化助手为 onefile 可执行文件。保存或编辑的遥控器型号写入 app 数据目录（同名覆盖内置型号），不修改已签名的应用包。
- 窗口：Dock 图标可恢复隐藏到后台的主窗口；菜单栏使用单色模板图标（`icons/tray-template.*`）。

Windows 托盘：左键松开恢复/显示窗口并置前，右键菜单；菜单“打开”和第二次启动程序共用同一显示函数。macOS 保留菜单式左键行为。

默认窗口为880×720逻辑像素，根据当前屏幕工作区和DPI缩小并居中。卡片保留两列，窄窗口单列，不缩放遥控器按键点击区域。
