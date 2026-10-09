# BOSS CLI 多岗位框架

岗位标准、真实岗位 ID、话术和执行范围通过配置更换；打招呼、求简历、接收附件共用身份核验、去重、预算、停止与结果汇总。

这是在本人授权招聘账号上运行的本地工具。默认计划不连接浏览器。新版控制器经过本地行为验证，**真实简历流程尚未试验，不能保证长期不封号**。

## 核心结构

| 文件 | 作用 |
| --- | --- |
| `profiles/*.json` | 岗位筛选标准与岗位绑定；仓库岗位 ID 全部为示例 |
| `scripts/boss_config.mjs` | 装入任意岗位集合，校验当前授权、预算、范围并冻结配置 |
| `scripts/boss_send.mjs` | 正常 UI 打招呼，核对关联回执，结束核对官方新增 |
| `scripts/boss_chat.mjs` | 聊天页面适配器，核对会话、岗位和具体附件消息 |
| `scripts/boss_resumes.mjs` | 多岗位求／收简历核心，稳定 ID 去重、预算、完整复查 |
| `scripts/boss_workflow.mjs` | 统一阶段入口及 `result.json` |

同名岗位通过 ID 区分。列表重排后仍按稳定会话处理；按钮变灰不算请求成功，附件卡片消失不算收到简历。未知结果隔离并停止，不自动重试。

## 安装与无消息计划

需要 Node.js 22.12 或更新版本、Python 3。真实浏览器运行还需要 macOS 上可连接的 Chrome 招聘端。

```bash
git clone https://github.com/sindrewisabella/boss-recruiting-template.git
cd boss-recruiting-template
npm ci
npm test
npm run plan
```

`npm run plan` 使用占位岗位及连接配置，平台动作数为 0。运维与增长仅为复用示例，规则不是所有岗位的通用招聘标准。

## 真实运行前的本机配置

先由本人登录招聘账号，读取页面完整账号菜单文本，再生成本机连接配置：

```bash
npm run setup -- --account "实际招聘账号的完整菜单文本"
./open-boss.command
./boss.command doctor
./boss.command jobs
```

`runtime.local.json` 自动指向本仓库安装的依赖，不复制 Cookie。它不进入 Git。保留唯一 BOSS 网页标签，电脑保持唤醒与网络可用，运行时不要手工操作 BOSS 或启动其他发送程序。

读取真实岗位 ID 与标签后，将示例复制到 `private/`，更换岗位绑定，调整画像和本轮配置引用；运行配置的 `runtimeFile` 要指向本机 `runtime.local.json`。人类决定标准、实际话术、阶段、数量上限和简历范围，AI 可以核对 ID、页面状态及证据。

只生成计划：

```bash
./boss.command plan --authorization private/run.json
```

仅在当前用户明确授权对应账号、岗位、动作和范围，补齐本轮日期与授权来源后，才实际执行：

```bash
./boss.command run --authorization private/run.json --execute
```

示例文件没有真实操作授权。单阶段用 `actions: ["accept"]` 只收附件；完整阶段按 `greet → request → accept`。已完成招呼与请求不会因再次复查附件重发。首次批量招呼须有单条实际话术读回证据。

## 检验与限制

- 19 项框架行为检查、9 项匹配检查，以及回执／身份回归检查通过；GitHub Actions 持续运行本地检查，不连接 BOSS。
- 求简历和接收附件核心仅做本地模拟验证。当前 DOM、Vue 字段、确认框及平台时序仍需未来明确授权的小范围实测。
- 只在 BOSS 接收附件，不下载 PDF、不导入飞书、不做简历评价。
- 验证码、403/429、身份变化、未知结果时停写；不修改指纹、换账号、搬运 Cookie 或重放私有接口。
- 批次与间隔是本地参数，不是平台官方安全阈值。休眠、锁屏、重启、长期无人值守未验证。
- 原有单次增长招呼实测与新版本地验证分别看待；个人台账与真实候选人记录未上传。

详细说明：[技能入口](SKILL.md) · [换岗配置](references/multirole.md) · [求／收简历](references/live-resumes.md) · [发送核验](references/live-greet.md) · [验证范围](verification.json)。

将整个仓库目录作为 `boss-recruiting-template` 放入本机 Codex skills 目录，即可作为可复用技能使用。
