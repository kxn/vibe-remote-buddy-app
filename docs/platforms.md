# 平台边界

管理协议、配置、固件更新与 UI 不直接使用操作系统窗口句柄。

- `src-tauri/src/platform/types.rs`：稳定的窗口标识、输入框匹配条件和应用身份类型。token 对上层是不透明字符串。
- `platform/windows/`：Win32 窗口枚举与激活、UI Automation 聚焦、TSF/IMM 输入法切换、开始菜单应用目录、启动入口及托盘 DPI。原有前台身份校验和超时保留。
- `platform/macos/`：macOS 实现入口，保留应用文件的 `open -a` 启动；窗口/AX 聚焦、应用目录和 TIS 输入法切换尚未实现，能力返回 false，调用明确失败。不得调用 Win32 或按 Windows 包名识别 Mac 应用。
- `platform/unsupported.rs`：其他平台的明确失败返回。
- `src/platform/`：前端平台适配合同、Windows 应用身份与输入框规则、macOS 预留实现。启动管理会话前通过原生 `desktop_platform` 选择实现。核心动作模型仅使用稳定动作 ID。

将来适配 macOS：在对应目录实现同一组接口、接入 AX 辅助功能权限和 TIS 输入源，不修改接收器协议。未获得权限要返回可识别错误，不返回虚假的成功。不把 HWND/PID 或 WindowsApps 路径判断放回通用层。

Windows 托盘：左键松开恢复/显示窗口并置前，右键菜单；菜单“打开”和第二次启动程序共用同一显示函数。macOS 暂保留 Tauri 菜单式左键行为，未实机验证。

默认窗口为880×720逻辑像素，根据当前屏幕工作区和DPI缩小并居中。卡片保留两列，窄窗口单列，不缩放遥控器按键点击区域。
