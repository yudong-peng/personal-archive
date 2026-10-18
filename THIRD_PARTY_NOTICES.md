# 第三方组件

| 组件 | 本项目使用版本 | 许可证及随附说明 |
| --- | --- | --- |
| Electron | 44.9.0 | MIT；运行时包另含 Chromium 等第三方许可，保留运行时的 LICENSE 和 LICENSES.chromium.html |
| sql.js | 1.15.0 | MIT；构建时复制其 LICENSE 与本地 WASM 资源 |
| fflate | 0.8.2 | MIT；用于本地 ZIP 导出和发布压缩包 |
| Koffi | 3.3.3 | MIT；用于 Windows 本机接口，构建包含其 LICENSE.txt 和对应平台依赖 |
| Mozilla PDF.js | 5.6.205 | Apache-2.0；位于 renderer/vendor/pdfjs，原始 LICENSE、VERSION.txt 及各子目录许可证均保留 |
| @electron/asar | 4.0.1 | MIT；仅构建工具 |
| @electron/get | 3.1.0 | MIT；仅运行时下载工具 |
| extract-zip | 2.0.1 | BSD-2-Clause；仅构建工具 |

PDF.js 随附的字体、CMap、图像解码器及 WASM 文件遵循其子目录中的具体许可，不能只保留主 LICENSE 而删除这些说明。

开发依赖及其传递依赖的具体许可，以各 npm 包内文件为准；锁定版本见 package-lock.json。本项目自身的许可证选择见 docs/LICENSING.md。
