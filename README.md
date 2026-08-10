# CYSO Editor VM

CYSO Editor 的虚拟机器（Virtual Machine），负责运行项目、解释脚本与积木逻辑。基于 [TurboWarp/scratch-vm](https://github.com/TurboWarp/scratch-vm)（Scratch 3.0 VM）定制，支持 CYSO 扩展体系与本地依赖。

## 主要改动

- **CYSO 扩展支持**：扩展 `tw-unsandboxed-extension-runner` 与外部扩展 worker 通信，适配 CYSO 扩展模型。
- **本地依赖**：通过 `local-deps/` 引入定制的 `scratch-parser` 与 `scratch-render-fonts` 修改版（由 package.json 以 `file:` 引用）。
- **工具方法适配**：调整消息格式化、XML 转义等工具方法。

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
