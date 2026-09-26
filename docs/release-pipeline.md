# 完整发布流程

App、固件、机型库独立版本；本次发行的组合在 build-info.json 固定。验证 Windows x64 与 macOS arm64。

## 输入

- App：package.json 的 version 是默认应用版本；BUDDY_APP_VERSION 可指定此次版本，Tauri 配置在 build/release-inputs 中生成覆盖值，不修改源码版本文件。关于页和 ZIP 文件名均包含版本及 App 提交前 8 位；未提交修改加 dirty。
- 固件：默认使用 receiver-firmware 当前二进制。`npm run release:from-source` 从公开 `firmware/` 子模块编译并生成完整安装包；`npm run release:from-source:latest` 可先更新子模块到最新 main，正式发布应提交指针。用 `npm run firmware:import -- <目录>` 将审查后的完整固件产物导入 receiver-firmware，仅白名单复制文件，校验目标、应用描述符、大小、SHA256、安装偏移。不复制 ELF/map/源码。BUDDY_FIRMWARE_DIR 是开发时显式替换输入的选项。
- 机型库：打包开始时解析 kxn/vibe-remote-buddy-models/main 的 SHA，所有后续请求使用该 SHA；资源逐文件核对索引大小/散列/身份。普通 release 不回退旧库；release:offline 明确使用仓库自带快照。

## 组合

生成目录固定为 build/release-inputs。前端内置快照、原生打包资源、外部 catalog 目录和每个板型首次安装的 catalog.bin 均使用同一份库。共享 TypeScript 编译器生成数据库，再更新各板型 install.json 中该文件大小与 SHA256；不改变原固件、分区表、空白 NVS。

版本记录在编译前生成。构建时注入界面，打包直接使用同一份记录，并检查源码摘要和提交未变化。build-info.json 记录各固件镜像 SHA256、机型库版本/提交/索引及数据库摘要、源码是否修改。不能把旧 EXE 单独拿来配一份新版本号。

打包独立烧录助手和许可证到 out/latest。release-asset.mjs 只压缩 build-info 中列出的、散列一致的文件；本地后来添加的机型不会混入公开 ZIP。NSIS 安装包从同一份已校验文件生成，并在安装、静默卸载的冒烟测试中检查用户文件得到保留。ZIP、安装包及各自的校验文件生成在 out/distribution。

## GitHub Actions

- main / pull_request：测试、构建便携 ZIP 和 NSIS 安装包，上传 artifact，不发布 Release。
- workflow_dispatch：version 留空取 package.json；publish=false 仅 artifact，true 以 v<version> 发版。
- v* tag：使用标签版本，测试成功后发布。
- build job 只读仓库；publish job 才有 contents:write。不执行 PR 上的发布。发行依赖最新机型库，因此相同 App 提交重打包也可能采用更新的库，精确组合以成品 build-info 为准。发布前分别核对 ZIP 和安装包的 SHA256，并检查它们的版本、提交与来源标记一致。
- 已存在的 Release 不覆盖，使用新版本。带预发布后缀的版本发布为 prerelease。

示例：PowerShell `$env:BUDDY_APP_VERSION='0.1.1'; npm run release`。源码版本文件无需为临时构建改动；正式长期默认版本可修改 package.json，并同步 lockfile。

参考：[GitHub workflow_dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)、[gh release create](https://cli.github.com/manual/gh_release_create)。

首页标题下和关于页均显示构建版本，例如 `0.1.2+abcd1234.release`。GitHub 正式发行标记 `release`，普通 CI 构建标记 `ci`，本地构建始终标记 `local`；未提交修改另加 `.dirty`。ZIP 文件名包含相同来源标记。

发布使用独立的 `Publish verified release` 工作流。它核对构建任务成功、包内文件哈希、release 标记、提交及标签一致后创建发行。若仅发布阶段失败，可手动输入原 Actions run ID 重试，无需重新构建；不接受 PR、本地包或普通 ci 包。标签已经存在时不向 Release API 另传提交 SHA，避免 GitHub 对工作流提交的额外范围检查。

## macOS

`build.yml` 调用可复用的 `macos.yml`，在 macos-14（arm64）上运行同样的测试并执行 `npm run release:macos`。仓库配置以下 secrets 时签名并公证：`APPLE_CERTIFICATE`（Developer ID Application 证书 .p12 的 base64）、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_API_KEY`（App Store Connect API 密钥 .p8 内容）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。未配置时（包括来自 fork 的 PR）只做 ad hoc 签名并上传测试 artifact。证书导入临时钥匙串，任务结束后删除。

发布时 `publish.yml` 下载同一次运行的 macOS artifact，核对 DMG 散列、build-info 中的提交、版本、release 通道、未修改源码与文件名，只有已公证的 DMG 才随 Windows 包一起发布。macOS 构建缺失或失败不阻止 Windows 发布。
