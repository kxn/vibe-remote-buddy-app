# App 实现分叉与 SSOT 审计（2026-09-22）

基线 c2fcf05。范围：添加/修复/适配、机型库及覆盖、动作编辑、预览外观、管理同步和 native 资源持久化。固件审计另存于固件仓库；此文不包含私有固件源码。

## 已修复的确定缺陷

| 编号 | 优先级 | 证据与结果 |
| --- | --- | --- |
| A1 | P1 | `service.loadModelResources` 先清空并修改全局 `remoteModels`，再加载本地编辑/override；后续验证或读取失败会出现列表、别名、Catalog 不一致。现改为本地构建完整结果，所有步骤成功后同步发布；异常保留上一份完整状态。回归覆盖无效机型、override 读取失败及随后成功刷新。 |
| A2 | P2 | `AppearanceControls.appearanceOf` 缺省 top/bottom 为 8%/18%，`remote-artwork.artworkPlacement` 为 7%/7%，只改颜色也会重新排布。默认值及更新逻辑移入 core，编辑器和渲染器共用，按既有渲染缺省保持 7%/7%。显式保存的外观不变；回归比较旧配置只改颜色前后的几何。 |
| A3 | P2 | `probe-layout.defaultBinding` 与固件标准映射不一致，新增数字键默认禁用。新增 `resources/standard-keys.json`，统一标准按键名和默认动作，固件从同源生成。机型自身默认、个人 override 与已绑定快照继续各自独立。 |

## 结构风险及具体收敛点

### A4 / P2：动作编码在多个入口重复

证据：`core/catalog.ts:action`、`core/actions.ts:voicePresets/inputMethodForVoice/builtinActions`、`ModelEditor.tsx` 的默认动作选择、`main.tsx` 的 KeyDialog/describeMap，以及 `core/models.ts` 的 tuple 校验。

这些入口分别操作资源 action、机型默认 tuple 和已绑定 Mapping，但现在各自写数字 kind、语音 preset、65534/65535，存在新增动作漏入口的风险。建议单独 `core/bindings.ts` 定义动作类型、编码/解码、合法性、默认值与显示描述；UI 只编辑输入，catalog 编译仅调用转换。操作系统实际快捷键映射仍属于平台层。A3 统一的是标准按键默认，尚不等于此处所有动作编码都已统一。

### A5 / P2：机型仓库状态存在多个视图，发布必须单一

证据：`core/models.ts` 全局 `remoteModels/modelOrigins`，`BuddyService` 内 `catalogModels/modelAliases/overriddenModels`，浏览器 `main.tsx` 从旧资源初始化而 native 由服务合成 Catalog、本地编辑和 override。

A1 已解决半发布缺陷。进一步建议 `ModelRepository` 返回不可变的统一快照，UI 只订阅它；浏览器 fixture 和 native 使用同一个合成器，I/O 来源不同即可。保留官方默认、本地默认编辑、设备个人映射的明确所有权，不能为了“一个 Map”把三个层级混为一谈。

### A6 / P2：同步决策与协议规则有多处维护

`service.ts` 的 connect/reload/scan 等入口分别判断 model_api/catalog_api 并触发安装；应统一同步策略（能力、版本、是否改变、失败处理），调用方只说明是否必须就绪。旧 API 是否下线是兼容范围选择，本轮没有默默删除。

`probe.ts:familyEvidence` 与 `onboarding.ts:transportReady` 以及固件 adapter 分别掌握报告要求。建议版本化协议描述和同一组跨层准入用例；精确 Map 排序、兼容 Map 需确认、未知适配是不同业务结果，不该混成名字匹配。

### A7 / P3：编辑器可复用领域控制，避免复制页面状态机

机型默认编辑与已绑定按键编辑共享按键动作语义，但保存目标和授权校验不同。优先抽纯函数和无持久化副作用的动作控件，保留各自保存事务。AppearanceControls 的领域函数已移到 core；其他编辑器不应从 React 组件导入业务规则。

## 不应误删的分支

- PairDialog 仍服务于已有绑定的修复配对，不是无人调用的第二套新增页面。
- 新增未知遥控器需要诊断枚举；已知设备的键码确认和语音验证不是同一种操作。
- 机型库默认与已绑定副本分离符合产品约定；同步库不能覆盖用户设备映射。
- Catalog 的编译器被应用和打包工具共用；生成的 C 表与 TypeScript 数据不是两个人工来源。
- 全局弹层滚动策略已集中于 `modal-scroll.ts`，不需要每个弹窗再写一套 wheel 处理。

## 建议实施顺序

1. 已完成：默认数据统一、外观默认统一、机型快照发布事务化。
2. 动作编码/校验/描述集中；用同一组动作覆盖 Catalog、两个编辑器、保存往返。
3. 协议描述和跨层准入用例集中；覆盖三种语音 family、额外报告、缺失必要服务、同名不同 Map。
4. ModelRepository 统一加载与同步入口，封装旧 API 边界，最后按支持策略退役旧路径。

第二轮复查重点：刷新失败不改变现有可见数据，已绑定设备不随标准默认变动，显式外观不回落到缺省值，公共应用仓库不依赖父目录构建。

验证：151 项 Vitest 通过；TypeScript/Vite 生产构建通过；15 项刷机辅助测试通过；Rust 7 项通过、2 项平台实时测试忽略。未进行本轮硬件实测。
