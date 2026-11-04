# 给同事安装

## 推荐方式：从 GitHub 克隆后运行安装脚本

前提：安装 Node.js 18+，并能运行 `node`。

```sh
git clone https://github.com/jy02815803/workbuddy-cost-router.git
cd workbuddy-cost-router
node scripts/install.cjs
```

Windows 也可下载 Release 里的 `workbuddy-cost-router-0.1.0.zip`，解压后进入插件目录，运行：

```powershell
node scripts\install.cjs
```

安装脚本会：

1. 把插件复制到 `~/.workbuddy/plugins/workbuddy-cost-router`；
2. 在 `~/.workbuddy/mcp.json` 注册 `workbuddy-cost-router` stdio server；
3. 按 WorkBuddy 的规则写入 `mcp-approvals.json` 信任记录；
4. 备份被修改的 `mcp.json` 和 `mcp-approvals.json`；
5. 保留其他 MCP server 和原有凭据。

然后完全退出并重新启动 WorkBuddy，在 `/mcp` 或连接器列表中查看 `workbuddy-cost-router`。

## 为什么不用本地插件市场

本机 WorkBuddy 5.9.3 实测：手工登记的本地 market 不一定出现在 UI，且产品配置刷新会清理手工写入的 `installed_plugins.json` / `settings.json` 插件记录。用户级 `mcp.json` 是这台 WorkBuddy 已稳定读取的 MCP 配置入口，适合给同事分发。

## 卸载

1. 从 `~/.workbuddy/mcp.json` 删除 `mcpServers["workbuddy-cost-router"]`；
2. 从 `~/.workbuddy/mcp-approvals.json` 删除以 `::workbuddy-cost-router` 结尾的键；
3. 删除 `~/.workbuddy/plugins/workbuddy-cost-router`；
4. 重启 WorkBuddy。

## 验证工具

安装后在 WorkBuddy 中调用或查看这些 MCP 工具：

- `cost_router_plan`
- `cost_router_run`
- `cost_router_report`
- `cost_router_models`
- `cost_router_auto_plan`

`cost_router_run` 默认不会调用 WorkBuddy 官方积分模型；详见 [README.md](./README.md)。
