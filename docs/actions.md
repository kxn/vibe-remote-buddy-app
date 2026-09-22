# 应用与窗口动作

参考 `kxn/remote-voice-input`，固定审阅提交 `8a13ae0c436583534eeb74e1a912a1cf1ad73458`。
参考路径：`native/src/MiRemote.Core/Commands/BuiltInCommands.cs`、`Actions/FocusInput.cs`、`Actions/WindowSwitcher.cs`、`MiRemote.App/WindowPicker.cs`。来源为 MIT（Copyright 2026 kxn）。没有移植 ASR、键盘钩子或旧桥接协议。

## 界面

按键功能按用途分类：
- 具名动作“切换到 ChatGPT / Codex / ZCode / 终端”：只选择动作，不选择运行中的进程。通过 Windows 已安装应用目录解析稳定 AppID；已运行则激活，未运行则通过系统启动入口启动并等待窗口后聚焦。
- 切换 / 打开应用：从正在运行的窗口中选应用，或选程序文件。已有窗口优先切换，否则启动。
- 窗口与桌面操作：窗口选择器、聚焦当前应用、同应用/全局上一个与下一个窗口、最大化/还原、最小化、关闭、显示桌面、任务视图、虚拟桌面、区域截图。
- 打开网页。
- 快捷键、音量与媒体仍保留，不改变用户原映射。

软件动作仍走固件已有 ACTION 事件和本机授权，不更新固件。重新打开编辑器会恢复已保存的软件动作。操作不会自动重试或排队补发。

## 平台边界

Windows 使用原生窗口枚举和 UI Automation。匹配逻辑/动作目录保留在 TypeScript；Rust 只提供 Windows API 和 UIA 调用。macOS/Linux 暂不显示为可用的输入聚焦/窗口动作，保留原来的应用和网页功能。

列出可见、非工具、非 cloaked 的用户窗口，不列全部后台进程；专用应用动作保存适配器 ID，不保存易失的 PID/窗口句柄或商店版本路径；其他自定义应用仍可选程序文件。窗口操作额外校验 HWND、PID 和路径。切换列表保留短期稳定顺序，避免每次 MRU 改变后只在两个窗口间来回跳。

UIA 只匹配指定应用的对话框名称或 AutomationId，不查文本内容、不随便选择第一个 Edit、不点击屏幕坐标。多个匹配、找不到、用户已换窗口均明确失败。终端保留已有输入焦点。UIA 在 MTA 工作线程执行，有交易超时和整体操作截止时间（已运行应用 2.2 秒，冷启动输入框最多 8 秒）；控件不响应时不阻塞 USB 心跳。

Windows 后台前置受系统限制：先普通激活，未获得前台时允许一次成对的左 Alt 按下/释放，随后验证结果。任何修饰键正在按住时不注入；右 Alt 不参与。两沿同批提交，不跨异步操作保持按键。切换过程中 HWND 暂时为空可等待；切换到第三个窗口则取消，不再抢回焦点。输入框聚焦前后再次核对。

窗口选择器为独立、可获得焦点的窗口，方向键/Enter/Esc 或鼠标操作，失去焦点关闭；不安装系统钩子，不临时重写板端映射。遥控器方向/确认键需要保持相应 HID 功能才能导航选择器；已改为其他软件动作的键不会被临时接管。它不是旧项目的逻辑按键捕获浮层。尚未移植宏、双击/长按层和 LAN 路由。

## 验证

- 34 项 TypeScript 测试：帧协议、会话、配置、专用动作类型、已关闭应用启动一次、未安装明确失败、启动等待超时、前台变化/前置失败不继续聚焦、并发动作不排队。
- 浏览器协议模拟：运行中应用列表、输入动作保存/重载、窗口命令保存/重载。
- Windows 原生：真实窗口列表、ZCode 与本机 ChatGPT/Codex 对话框聚焦；不输入或发送文字。窗口选择器读取 15 个窗口、方向选择和 Esc 关闭正常，主窗口与板端管理会话保留。没有代替用户修改按键映射，遥控器触发动作已由用户验证。
- 应用版本更新可能改变无障碍名称，此时保留明确失败，需更新 `src/core/actions.ts` 的适配。网页版不承诺自动切换浏览器标签；终端/其他版本仍需对应环境验证。

参考文档：
- https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-threading
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow

## 2026-09-18 界面修订

- 移除统一按键设置入口，各遥控器单独配置；不清除现有映射或用户配置。
- 默认语音预设保存为 VOICE_PRESET（kind=5）：豆包 value=1，微信 value=2。固件按主机类型选择 Windows 的右 Alt / 左 Ctrl + 左 Win，或 macOS 的 Fn（尚待 Mac 实测）；其他系统沿用 Windows。自定义快捷键仍为 VOICE（kind=3），不会自动改变。
- 录音只更新卡片固定状态行和动画，不插入页面提示行；尊重减少动态效果设置。
- 首页缩略图与按键页共用按用户实物照片排列的小米 RC003 布局：电源/语音、圆形方向盘、左侧返回/主页/菜单、右侧音量长条/TV。
- Windows 开发版与发布版均使用 GUI 子系统；已安装应用查询进程使用 CREATE_NO_WINDOW。
- 回归验证：具名动作单次选择与保存、微信预设回读、小米 13 键位置、四卡片录音前后几何尺寸不变。原生验证已安装应用目录、ZCode 注册入口调用和 EXE GUI 子系统；没有关闭用户正在使用的应用，完整冷启动通过模拟状态机覆盖，仍需实际关闭应用后回归。

### 窗口选择器焦点修正

创建窗口不代表它是前台窗口，也不代表内嵌 WebView2 已取得键盘焦点。选择器现在先隐藏创建，页面完成列表加载并安装按键处理后报告 prepared；原生层核对原前台未变化，再显示、验证前台 HWND，并单独聚焦 WebView。页面确认 document.hasFocus，原生再次核对 HWND 后才结束打开操作。准备/焦点确认总计限时 6 秒，失败销毁窗口并把错误交回主界面。失去焦点的关闭逻辑从真实确认后启用，取消原来的固定 300ms 延迟；重复打开有互斥保护。

原生回归脚本 `host-app/tests/picker_native_check.py` 使用 Windows SendInput 发送方向键和 Enter/Esc；不使用 Playwright 对页面直接发键替代操作系统焦点验证。运行时需本机调试 WebView 9223，并避免同时按住物理修饰键。
`n实测通过：从 ZCode 前台连续 3 轮打开选择器，Windows 前台与 document.hasFocus 均确认；真实系统方向键、Esc、Enter 生效，重复打开和切走关闭正常，管理会话保持。22 项单元测试通过。

## 随遥控器切换输入法

专用应用切换和“聚焦当前应用输入框”在聚焦成功后，读取触发遥控器的板端语音键（逻辑键 2）映射：VOICE_PRESET 的 value=1/2 分别对应豆包/微信；既有 VOICE + 右 Alt 对应豆包，VOICE + Ctrl+Win 对应微信。禁用或自定义组合保持输入法不变。每次读取当前设备的设置，不使用其他遥控器或全局缓存。

Windows 使用 TSF 枚举已启用的简体中文键盘服务，按输入法名称选定 profile；ActivateProfile(FORSESSION) 切换当前桌面会话（用户已接受其他窗口也可能受到影响），不更改默认输入法、不启用未启用的 profile。聚焦后通过目标焦点的默认 IME 窗口请求打开和 NATIVE 中文转换模式，保留其他转换标志，并读取验证；每次请求校验目标前台身份，消息超时有界。未安装、切换或中文状态确认失败均上报原始错误；不模拟 Shift、Win+Space 轮换，不自动重放动作。macOS/Linux 暂未实现对应平台切换。

验证：单元测试覆盖两只遥控器共享动作却各自使用豆包/微信配置、断开和旧设备事件；Windows 原生实测 ZCode 中从小狼毫关闭状态切回豆包中文，并验证未安装微信及失效前台被拒绝。微信实际切换需在安装微信输入法后验证。

官方资料：
- https://learn.microsoft.com/en-us/windows/win32/api/msctf/nf-msctf-itfinputprocessorprofilemgr-activateprofile
- https://learn.microsoft.com/en-us/windows/win32/api/imm/nf-imm-immgetdefaultimewnd

板端动作“切换会议 / 普通模式”不需要上位机运行，配置和生命周期见 [protocol.md](protocol.md#临时语音模式切换voice_toggle1)。
