# Buddy 管理接口 v1（RBP/3）

本应用使用的 Buddy 管理接口，语言和操作系统无关。本文仅公开客户端通信约定，不包含接收器固件源码。
USB CDC 只承载管理和自定义动作；音频为 UAC 16 kHz / 单声道 / PCM S16LE，标准按键为 USB HID。
不暴露 GATT handle、原始通知和编码音频，不兼容旧单设备管理命令。

## 传输、会话与重试

采用 RBP/3：32 字节小端头、CRC32C、COBS、零分隔符，payload 上限 512 字节。
**本 API 的 payload 是 UTF-8 JSON 对象，不是旧命令的 TLV。** opcode 范围 0x0400–0x0410、事件 0x0480–0x0482。
头 major=3、minor=0、kind=1 请求/2 响应/3 事件；flags、reserved、connection_id、请求 status 均为 0。
slot/generation 在 JSON 中；不能把 header.connection_id 当作“当前选中遥控器”。

客户端同时只提交一个未完成请求。request_id 从 1 严格递增；每方向 tx_seq 从 1 严格递增，包括事件和重试。
HELLO 使用 session_id=0、tx_seq=1，请求 `{"api":1}`，响应头返回非零 session_id；后续请求携带此 session。
每 2 秒 PING 一次即可，10 秒未收到有效会话的顺序请求则失效。GOODBYE、串口 DTR 关闭、USB 拔除也释放管理权。
仅“打开串口”不构成接管；终端读日志也不应阻止自动配对。串口波特率是 CDC 参数，**1200 会进入下载模式**，普通管理用 115200。

管理会话有效时不自动开始新配对或修复绑定；已有设备仍自动重连，HID/UAC 不依赖管理心跳。
接管时取消尚未提交的自动配对；用户已经明确发起的配对/解绑，在客户端离开后仍执行到终态。
无有效会话时，已支持型号的可连接广播可以在有空 slot 时自动配对；同 identity 重新配对保留原 slot 和映射。
SDK 明确报告密钥丢失时，仅对同 identity 且允许配对的设备尝试一次 SMP 修复；普通建联超时/射频错误不清除 bond。
不同 identity，即使名称相同也视为不同设备。不自动删除现有 slot 给新设备腾位置。

响应丢失时只允许重发**最近一次**相同 request_id/opcode/逐字节相同 JSON，请求的 tx_seq 仍增加。
固件缓存最近一次响应，不重做写入/配对/解绑。HELLO 响应丢失也可用相同请求、下一 tx_seq 重试。
如果无法判断某请求是否被固件收到，或串行序号出现缺口，关闭并重新打开串口重新握手，再查询 OPERATION/SLOT；不能盲目换 request_id 重放修改。
同 request_id 不同内容会撤销会话。session 失效、CRC 错误、顺序不符的帧不执行。
队列满时记录故障并撤销管理会话，不影响已有 BLE 语音。软件动作不跨会话回放。
请求 JSON 拒绝重复字段、非整数数字、负数和越界整数；最大嵌套深度 4。无参数请求使用 `{}`。

## 指令表

表中 `S` 表示 `slot`（0–3），`P` 表示 `peer_id`（读取 SLOT 得到）。除了 SLOT，单设备读写均需要 `{slot:S,peer_id:P}` 防止操作陈旧的 UI 行。
所有成功同步操作 status=0；异步启动 status=1，返回 operation_id。异步最终结果通过 OPERATION 查询或事件取得。

| opcode | 名称 | 请求附加字段 | 响应内容 |
|---|---|---|---|
| 0x0400 | HELLO | api=1 | api、lease_ms=10000、slots=4；session 在头中 |
| 0x0401 | PING | 无 | 空对象 |
| 0x0402 | CLOSE | 无 | 空对象，释放管理权 |
| 0x0403 | INFO | 无 | firmware、slots、voice_owner、manual_pairing、scanning、scan_epoch、free_slot |
| 0x0404 | SLOT | slot | slot、peer_id、generation、state、name、model、battery、voice_state、voice_down、voice_rejected、keys_hex、map_revision、error |
| 0x0405 | SCAN | duration_ms：1000–30000 | scan_epoch；清空候选表，主动扫描 |
| 0x0406 | CANDIDATE | index：0–23 | candidate_id、scan_epoch、name、rssi、known、bound_slot、age_ms |
| 0x0407 | PAIR | candidate_id、scan_epoch | operation_id；设备 READY 且持久提交后才完成 |
| 0x0408 | UNBIND | S、P | operation_id；断链、清除本 slot 密钥/缓存/映射 |
| 0x0409 | OPERATION | 无 | operation_id、kind、pending、slot、peer_id、result、uncertain |
| 0x040a | CATALOG | S、P、index | key、name、model、count、默认 kind/modifiers/value、layout；有坐标时 x/y |
| 0x040b | MAP_GET | S、P、key | key、kind、modifiers、value、revision |
| 0x040c | MAP_SET | S、P、revision、key、kind、modifiers、value | 新 revision |
| 0x040d | MAP_RESET | S、P、revision | 该遥控器恢复默认，新 revision |
| 0x040e | STATS | index | 见诊断表 |
| 0x040f | CANCEL | operation_id | 取消正在配对的操作；已开始解绑不撤回 |
| 0x0410 | SCAN_STOP | 无 | 结束人工扫描；不关闭后台重连服务 |

slot 为空时 peer_id=0；free_slot=-1 表示没有空位；voice_owner=255 表示无占用。
SLOT.state：0 未绑定、1 离线、2 建联、3 配对、4 初始化、5 READY、6 不支持、7 错误。
battery=255 为未知。keys_hex 是 16 个十六进制字符，对应逻辑 key_id 位图；语音键物理状态单独读 voice_down（联通的语音通知是独立通路）。
voice_state 为现有 RBP_VOICE_* 常量（0–4），不是连接状态；数值由设备返回。
generation 每次建联更新，只在本次启动内有效；固件重启或新管理会话后应重新读取所有 slot。

候选表按 index 查询至 23，NOT_FOUND 表示空/过期项；不要假定某个空项之后都为空。
候选 15 秒后过期，scan_epoch 防止使用旧扫描视图。known 只是型号广播提示，完整支持性仍在配对后按报告布局验证。
SCAN 可能因正在建联/配对或语音通道被占用返回 BUSY；后台仅对发现的已绑定设备发起建联，单次建联最长 3 秒，客户端可以稍后重新请求。离线设备不轮流占用整段建联超时。语音占用期间暂停扫描及新的建联尝试，已有连接保持；语音结束并排空缓冲后恢复后台发现。人工扫描被语音暂停时仍按原截止时间到期，不延长扫描期限。
同 identity 的 RPA 候选在加密后会归并到原 slot，不生成重复记录；若原 slot 已在线则拒绝重复建联。
绑定表满但有离线连接 context 时，可临时配对核验新 RPA 的身份；属于已有设备则归回原 slot，未知设备则返回资源不足并删除临时 bond。NimBLE 保留第 5 个临时 bond 容量，永久设备 slot 仍只有 4 个。四条连接全部占用时返回资源不足，不驱逐在线设备。

存储写入失败保留底层 NVS 错误供诊断；收到 STORAGE_FAILED 后重新查询实际状态，必要时重启核对。
解绑先写持久 tombstone 再删 bond，避免中途断电后复活绑定。断电留下的无 slot 临时 bond 会在启动清理。
旧单设备绑定迁移至 slot 0；旧元数据只作迁移输入，存在 slot 0（包括空 tombstone）后不再次导入。

## 映射和布局

固件内置 `xiaomi.rc003` 和 `unicom.hid_ico.v1` 的逻辑键目录及默认映射。
以稳定逻辑 key_id 保存每个设备的覆盖，不能用 HID 原始位序或 UI 序号作为配置键。
CATALOG 返回全部支持键及默认值，MAP_GET 返回实际值。MAP_SET 比较 revision，旧 revision 返回 BAD_STATE，客户端刷新后再修改。
每条修改在一个 NVS blob 中提交，成功响应之后才生效；录音/配对/解绑期间修改返回 BUSY。
更改映射会释放该设备当前普通键，原先按住的键必须松开再按，避免立即触发新动作。

| kind | 含义 | modifiers | value |
|---|---|---|---|
| 0 | 禁用 | 0 | 0 |
| 1 | USB Keyboard | HID 修饰键位图 | Keyboard usage 4–223；0 允许仅修饰键 |
| 2 | USB Consumer | 0 | 0 音量+、1 音量−、2 静音、3 播放暂停、4 下一首、5 上一首、6 停止、7 浏览器主页 |
| 3 | 语音 PTT 快捷键 | HID 修饰键位图 | 同 Keyboard；默认右 Alt=0x40、value=0 |
| 4 | 软件动作 | 0 | 1–65535 的不透明 action ID |

modifiers 位：左 Ctrl/Shift/Alt/GUI 为 bit0–3，右 Ctrl/Shift/Alt/GUI 为 bit4–7。
字母 A 为 usage 4，F1 为 0x3a，F13–F24 为 0x68–0x73；不使用 Windows VK 编号。
语音键（key_id=2）固定为 kind=3，但快捷键可以改；其他键不能改成 kind=3，因为蓝牙协议不保证任意按钮能发起录音。
kind=4 不伪造 HID 键，无管理程序时无动作，不缓存到下次启动。操作含义（如切到 ChatGPT）由未来上位机按 action ID 配置。

默认方向/确认/返回/Home/Menu 为对应键盘键，音量/静音为 Consumer，联通数字和 * / # 为标准键盘字符；其他未指定键禁用。
联通布局 `unicom.photo.v1` 的 x/y 为照片近似归一化中心，不是物理尺寸。图中 TV 没有确认 BLE 报告，不作为可映射键返回。
小米当前没有经核对的几何布局，layout=null；上位机仍可按目录名称显示列表，不能把缺少照片坐标理解为不支持按键。

## 互斥和事件

第一台物理语音按下或协议验证通过的原生音源开始取得 owner；ATVV 通知可以先于 HID 按下到达，两种顺序使用同一占用，物理按键状态仍单独维护。其他语音按压拒绝，voice_rejected=true；必须松开再按，不自动排队接管。
语音占用包括有界结束/排空阶段。owner 蓝牙断链后保留已解码的有效尾音，排空期间仍占用语音通道；其他设备掉线不影响 owner。USB 故障、显式中止和无效音频错误仍立即释放快捷键并清理缓冲。
物理松手后等待音源结束并送完缓冲，再保留 100 ms USB FIFO/主机调度余量后释放快捷键；蓝牙断链按音源结束处理。从进入排空阶段起最多等待 5 秒，超过时记录排空超时错误并强制释放，防止消费者不读音频造成锁键。排空期间重复按压不启动新录音，必须松开再按。此流程不能获取遥控器停止发送以后的音频，也不能延长遥控器自身录音上限。
录音期间普通键、软件动作、非音量 Consumer 都暂停，期间按压丢弃；音量+/音量−/静音继续。
同一普通键被多台按住时要最后一台释放才松开，六键以上使用标准 ErrorRollOver，释放后恢复。

| opcode | 事件 | JSON |
|---|---|---|
| 0x0480 | ACTION | slot、peer_id、generation、key、action、time_ms |
| 0x0481 | CHANGED | slot、peer_id、generation、state；提示重新读取 SLOT |
| 0x0482 | OPERATION_EVENT | 与 OPERATION 相同 |

ACTION 是**一次物理按下的触发**，不是按住/松开对；上位机应执行一次动作，不模拟长期持键。长按不重复、跨会话不重放。
事件可先于启动请求的响应；用 operation_id 关联。OPERATION 保存最近一次操作，用于结果事件丢失后的核对。
设备电量、键快照和语音状态可轮询 SLOT；CHANGED 不是每个属性的订阅流。

## 诊断与错误

沿用 RBP status：0 OK、1 ACCEPTED、2 INVALID_ARGUMENT、3 UNSUPPORTED、4 BAD_STATE、5 BUSY、6 NOT_FOUND、7 TIMEOUT、8 PAIRING_FAILED、9 LINK_LOST、10 STORAGE_FAILED、11 RESOURCE_LIMIT、12 CANCELLED、13 DUPLICATE、14 SESSION_MISMATCH、15 DEVICE_ERROR、16 VOICE_UNAVAILABLE、17 VERSION_MISMATCH。

STATS index=0：heap_free/heap_min/heap_largest（内部 RAM 字节）、psram_free。
index=1–4：最近故障，字段 sequence/domain/stage/code/context/count/time_ms/evicted；无对应项返回 NOT_FOUND。
code 保留 SDK/ATT/NVS 的原始数值，公共 result 不替代诊断。GAP stage=0x1100+阶段，context=slot；GATT stage=0x1000/0x1001，context=连接句柄。
index=5：`words` 为版本化音频快照的 18 个 u32；index=6 为 USB 快照的 16 个 u32，定义与 `standalone_stats` / `standalone_usb_stats` 一致。不包含语音内容。

## 首次客户端交互示例

1. 115200 打开 CDC，HELLO `{api:1}`，保存响应 session_id；启动 2 秒心跳。
2. INFO，依次 SLOT `{slot:0}` … `{slot:3}`；未绑定项也显示为空 slot。
3. SCAN `{duration_ms:10000}`，逐项 CANDIDATE，人工选定后 PAIR `{candidate_id:…,scan_epoch:…}`。
4. 等对应 OPERATION 完成，再查询 SLOT；仅 READY 时显示可用。
5. CATALOG 逐项获取布局和默认映射，MAP_GET 获取实际配置；MAP_SET 带当前 peer_id/revision。
6. 处理 ACTION 事件；退出时 CLOSE 后关闭串口。

JSON 示例为了可读性省略部分引号，实际 payload 必须是合法 JSON，字段名使用双引号。



## 帧布局

COBS 解码后，所有多字节整数为小端。偏移 0–1 为 ASCII RB；2 为 major=3；3 为 minor=0；4 为 kind；5 为 flags=0；6–7 为 header_size=32；8–11 session_id；12–15 tx_seq；16–19 request_id；20–21 opcode；22–23 status；24–25 payload_length；26–27 reserved=0；28–31 connection_id=0。随后为 UTF-8 JSON，末尾 4 字节是对头和 payload 计算的 CRC32C。整个帧 COBS 编码后以 0 分隔。实现与已知向量见 src/core/wire.ts 和 tests/hello-vector.json。

CANDIDATE.bound_slot=-1 表示未绑定，0–3 表示已绑定位置，不能仅判断是否小于 4。

## 自动语音预设（voice_presets=1）

INFO 新增 voice_presets=1，以及 host_os：0 未知、1 Windows、2 macOS、3 其他。识别来自 USB 字符串描述符请求行为，只是推测；其他和未知采用 Windows 快捷键。分类只影响默认语音预设，不改变普通键、音频格式、USB VID/PID 或蓝牙行为。

映射 kind=5 表示“输入法默认快捷键”：modifiers 必须为 0，value=1 豆包 / 2 微信，仅允许逻辑语音键 key=2。Windows/未知/其他分别发右 Alt、左 Ctrl+左 GUI；macOS 发 Apple Fn。kind=3 始终是用户指定的原始快捷键，不按主机类型转换。

出厂映射和 MAP_RESET 使用 kind=5/value=1。已有持久 kind=3 映射不迁移，因为不能判断原来是预设还是用户手工选择；用户重新选择输入法预设后才保存 kind=5。无需扩大持久映射结构。旧固件不支持 kind=5，应用检测 INFO.voice_presets 后明确要求升级，不悄悄改成固定键。

Fn 使用 Apple Top Case Usage Page 0x00ff / Usage 0x03，在原 8 字节 keyboard 报告的第二字节 bit0 中发送，其余 7 位保留。每次语音取得 owner 时锁定本次键盘报告，按原尾音排空策略释放；检测结果变动不能中途换键。没有新增 HID 队列或终端驱动。

macOS 目前没有实机验证。Apple 驱动对 vendor usage 支持存在条件，不能保证保持接收器自有 VID/PID 的所有新 macOS 均会把报告当作 Fn；这部分是待验证实现，不宣称已实现免驱兼容认证，也不冒用 Apple 设备身份。
