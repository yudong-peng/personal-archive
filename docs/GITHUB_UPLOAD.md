# 上传到 GitHub 与生成可下载软件

## 1. 解压源码包

解压 `personal-archive-v0.3.0-github-source.zip`，进入其中的 `personal-archive-v0.3.0` 文件夹。
应直接看到 README.md、package.json、app、renderer、scripts 等文件。上传的是这个文件夹中的项目内容。

源码包和可运行程序用途不同：开发者使用源码；普通使用者从 Release 下载完整程序 ZIP，解压后运行 EXE。

## 2. 建立空仓库

在 GitHub 新建仓库，例如 `personal-archive`，可按需要选择公开或私有。首次上传建议创建空仓库，不预先生成 README、.gitignore 或 LICENSE，以免与本地文件冲突。

本包没有替你选择项目开源许可证；选择前先查看 LICENSING.md。

## 3. 推荐使用 Git 上传

安装 Git，在解压后的源码根目录打开 PowerShell：

```powershell
git init -b main
git add .
git status
git commit -m "Initial import: Personal Archive v0.3.0"
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

将 `YOUR_ACCOUNT/YOUR_REPOSITORY` 替换为实际账号和仓库名。如果 Git 提示没有提交身份，先按提示配置自己的 name 和 email。认证时使用你自己的 GitHub 登录方式，不在项目文件中填写令牌。

提交前的 `git status` 应只列出源码、文档、测试和工作流，不应包含个人 .pav、API 设置、恢复密钥、node_modules、dist 或 build。

也可使用 GitHub Desktop，通过添加现有目录、提交和发布仓库完成上传。网页上传时需要确认 `.github`、`.gitignore` 和 `.gitattributes` 也已上传；推荐用 Git 或 GitHub Desktop保留完整目录。

## 4. 检查源码

```powershell
npm ci
npm run check
npm test
npm start
```

上传后 `Source checks` 工作流会自动执行语法与单元测试。首次创建这些工作流的远程运行结果，需在你自己的 GitHub Actions 页面查看；本源码导出过程没有向任何 GitHub 仓库推送或触发远程任务。

## 5. 手动生成 Windows 完整包与更新包

在 GitHub 仓库的 Actions 页面选择 **Build Windows packages**，点击 **Run workflow**，选择 main 后运行。

工作流在 Windows 环境安装依赖、检查源码、运行单元测试并生成完整包和更新包。成功后，在该次运行的 Artifacts 中下载 `personal-archive-v0.3.0-windows-packages`，解压后包含两个软件 ZIP 和 SHA256SUMS.txt。

工作流不需要真实 API Key，也不需要个人资料；它不会自动创建 Release。文件保留时间由工作流设置控制，建议下载后放到正式 Release。

也可以在自己的 Windows x64 电脑运行：

```powershell
npm ci
npm run package:release
```

## 6. 发布软件

在仓库 Releases 中创建 v0.3.0 Release，发布说明可参考 `docs/RELEASE_NOTES_v0.3.0.md`，上传：

- `personal-archive-v0.3.0-win-x64.zip`：供首次使用者下载。
- `personal-archive-v0.3.0-update.zip`：供适用原始版本的已有使用者更新。
- `SHA256SUMS.txt`：下载校验值。

原先已提供的正式 v0.3.0 更新包与这里重新生成的 ZIP 可能因压缩或文件时间戳产生不同 ZIP 哈希；应使用与本次上传的文件相对应的 SHA256SUMS.txt。

更新脚本核对的是 app.asar 的发布基准哈希。不能只修改显示版本就宣称适用另一个历史包。维护下一版时，按 README 的说明同步修改升级目标和基准清单。

## 7. 后续修改

日常开发只提交源码、文档和锁文件。构建产物放 Release，实际使用的数据目录保存在自己的电脑，不要放进仓库。
