# CYSO Editor VM

CYSO Editor 的虚拟机器（Virtual Machine），负责运行项目、解释脚本与积木逻辑。基于 [TurboWarp/scratch-vm](https://github.com/TurboWarp/scratch-vm)（Scratch 3.0 VM）定制，支持 CYSO 扩展体系。

## 主要改动

- **CYSO 扩展支持**：扩展 `tw-unsandboxed-extension-runner` 与外部扩展 worker 通信，适配 CYSO 扩展模型。
- **工具方法适配**：调整消息格式化、XML 转义等工具方法。

> 注：`scratch-parser` 与 `scratch-render-fonts` 均以 monorepo 内的兄弟仓库（`../scratch-parser`）或
> scratch-gui 自带的字体目录（`scratch-gui/src/lib/tw-scratch-render-fonts`）引用，不再使用 `local-deps/` 内联副本。

## 开发

```bash
npm ci
npm test  # 运行测试
```

## 相关仓库

- [CYSO-Editor/gui](https://github.com/CYSO-Editor/gui)：图形化用户界面
- [CYSO-Editor/desktop](https://github.com/CYSO-Editor/desktop)：桌面客户端

## License

[MPL-2.0](./LICENSE)
