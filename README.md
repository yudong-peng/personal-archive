# 个人档案库 · Personal Archive

本地单用户个人资料管理程序，当前版本 **v0.3.0**。适合整理升学、求职、评奖时经常使用的经历、证件、证书和附件。

界面由本地 HTML/CSS/JavaScript 渲染，通过 Electron 在桌面窗口运行。Windows 成品从 `PersonalArchive.exe` 启动，不需要额外安装 Node.js、Python 或启动网页服务器。此仓库包含源码；首次开发安装依赖及构建需要网络，日常档案管理可以离线使用。AI 识别是默认关闭的可选联网功能。

## 功能

- 密码登录、恢复密钥、自动锁定；Windows Hello 快捷登录，依赖本机已配置的指纹、人脸或 PIN。
- 基本信息、家庭信息、就学、实习、实践、工作、项目、获奖、科研、证书、技能和照片等分类。
- 个人与家庭信息各保留一份，以完整页面展示；就学经历按阶段使用对应字段。
- 个人信息中可维护身份证、学生证等证件资料，并关联附件。
- 日期选择器、下拉选项、自定义字段、多种描述版本、标签、置顶、搜索、材料清单和回收站。
- 图片与 PDF 附件拖入、命名、分类关联、本地预览、图片缩放旋转与 PDF 翻页。
- 白天／夜晚／跟随系统主题，资料列表与详情区的分隔线可以拖动。
- 可选择资料目录和默认下载目录；支持 TXT、JSON、CSV、ZIP、附件原件和完整加密备份。
- 证件与证书有效期提醒，可设置提前天数、单项关闭和稍后提醒。
- 半透明桌面悬浮窗：快速保存标题与附件到收集箱，或为已有资料添加附件；支持记录下载。
- AI 辅助填写：用户配置自己的兼容 API，选择图片或 PDF 页面，核对候选字段后应用，支持撤销上次填写。

## 开发运行

推荐 **Node.js 24 x64**，最低 Node.js 22.12.0。Windows 目标为 10/11 x64；Windows Hello、系统通知和开机启动属于 Windows 平台能力。

在源码根目录执行：

```powershell
npm ci
npm start
```

`npm ci` 使用 `package-lock.json` 中锁定的版本，会下载 Electron 和当前系统对应的依赖。不要使用 `--omit=optional`，Windows 构建需要 Koffi 的 Windows x64 原生包。

源码可在有图形桌面的其他平台运行进行开发，但此项目只提供 Windows x64 成品的构建流程。

## 检查与测试

```powershell
npm run check
npm test
npm run test:desktop
```

- `check`：自有 JavaScript 语法及 JSON 检查。
- `test`：64 项 Node 单元测试，不启动桌面窗口。
- `test:desktop`：依次执行四组 Electron 桌面检查，共 99 项。需要可用的图形桌面。

桌面测试使用临时资料目录、合成附件和本机模拟 API，不读取使用者的正常档案，也不要求真实 API Key。Windows Hello 测试使用模拟凭据接口，不能替代指纹／人脸硬件实测。更多范围见 [VALIDATION.md](VALIDATION.md)。

## 构建 Windows 程序和更新包

在 Windows x64 上安装依赖后执行：

```powershell
npm run package:release
```

产物位于 `dist/`：

| 产物 | 用途 |
| --- | --- |
| `PersonalArchive-win-x64/` | 完整便携程序，含 `PersonalArchive.exe` 和全部运行依赖 |
| `PersonalArchive-v0.3.0-update/` | 对已发布 v0.2.0～v0.2.3 原始构建的更新目录 |
| `personal-archive-v0.3.0-win-x64.zip` | 完整程序 ZIP |
| `personal-archive-v0.3.0-update.zip` | 更新 ZIP |
| `SHA256SUMS.txt` | 两个 ZIP 的校验值 |

也可以分别执行 `npm run build:win`、`npm run build:update`。两个构建共用 `scripts/package-app.cjs`，均包含 Windows Hello 的 Koffi 依赖和本地 PDF.js 资源。

本仓库附带手动触发的 Windows 构建工作流。操作方式见 [GitHub 上传与发布指南](docs/GITHUB_UPLOAD.md)。工作流生成下载用产物，不会自动发布 Release。

**更新包校验的是原始 app.asar 的哈希，不只是版本号。** 从源码重新构建的相同版本未必具有相同哈希。维护后续版本时，必须更新升级脚本的目标版本和 `scripts/update-bases.json`，只加入已确认发布的基准哈希。不能随意把本地新构建视为已发布的基准包。

## 资料与密钥保存

- 默认资料文件为 `%LOCALAPPDATA%\PersonalArchive\archive.pav`，可以在程序中选择其他目录。
- SQLite 在内存中使用，保存时整体加密写入 `.pav`。照片、PDF 和正文一同保存在加密档案中。
- `backups/` 包含自动生成的加密备份；更换密码不会改写旧备份的密码。
- 保存位置和界面等本机设置由程序维护，不应提交到仓库。
- `PERSONAL_ARCHIVE_HOME` 可指定独立的数据／测试根目录；它不自动迁移现有资料。
- API Key 使用系统安全存储加密，独立于档案及普通导出；安全存储不可用时，只在本次解锁会话中保留。
- 普通 TXT／JSON／CSV／ZIP 和原件导出不带档案密码保护。

首次创建时请保存恢复密钥；原程序目录和数据目录可以不同。升级前程序会保留资源备份，v0.3.0 首次解锁时另存升级前加密档案备份。

## AI 使用

进入“设置与备份 → 提醒、悬浮窗与 AI”，开启总开关并填写基础地址、API Key 和模型名称，然后使用“测试连接”和“测试图片”。

本版使用 **OpenAI 兼容 Chat Completions** 文字／图片协议，提供常见服务及本机接口预设，地址可以自定义。是否支持图片取决于你选择的具体模型和接口；本版不包含所有厂商的原生协议。

- 图片与扫描 PDF 使用支持视觉输入的模型。
- PDF 在本地选择页码后转为图片或提取文字；PDF 打开密码仅在本地使用。
- 只有点击“发送所选材料并识别”才发送选定材料，不发送整个数据库和其他资料。
- AI 建议需要核对后才写入，已存在的字段默认不覆盖。
- 调用费用由用户自己的 API 账户承担；识别失败不删除本地已保存附件。
- API Key 不需要填写到源码、GitHub Secrets 或示例配置中。

## 提醒与悬浮窗

提醒默认提前 30 天，长期有效的证件不提醒；只有年份／年月时按年末／月末计算。系统通知需要单独开启。到期检查在程序运行且档案已解锁时进行；锁定后暂停，解锁后重新检查。

悬浮窗、关闭后驻留托盘和开机启动默认关闭。悬浮窗与主窗口共享锁定状态；保存后的收集箱记录不会自动清除，未保存内容会在自动锁定时清空。

## 文件结构

```text
app/                    Electron 主进程、加密档案、附件、Hello、AI 与设置
renderer/               本地网页界面、表单、预览、悬浮窗与主题
renderer/vendor/pdfjs/  随源码提供的离线 PDF.js、字体和许可文件
scripts/                检查、测试、Windows 构建及 ZIP 打包脚本
tests/                  单元测试、桌面测试及合成 PDF
update-assets/          升级脚本、更新说明及验证记录
docs/                   GitHub 上传指南、版本说明和许可证说明
.github/workflows/      自动源码检查与手动 Windows 构建
package.json            项目命令和固定依赖版本
package-lock.json       可复现的依赖锁文件
```

[更新记录](CHANGELOG.md) · [v0.3.0 发布说明](docs/RELEASE_NOTES_v0.3.0.md) · [第三方组件](THIRD_PARTY_NOTICES.md) · [许可证说明](docs/LICENSING.md)

本项目尚未选定自己的开源许可证，`package.json` 暂标记为 `UNLICENSED`；请由仓库所有者决定。第三方组件的许可证随相应文件保留。
