# 多岗位配置与合并结果

## 分工

| 内容 | 位置 | 换岗位时做什么 |
|---|---|---|
| 岗位标准与真实绑定 | `profiles/*.json` | 改规则、岗位 ID、完整标签；可以不同岗位用不同画像 |
| 本轮动作、话术与范围 | schemaVersion=2 的动作配置 | 改阶段、岗位集合、实际话术、数量和范围 |
| 执行与核验 | `scripts/boss_send.mjs`、`boss_resumes.mjs` | 不因运维换增长而改代码 |
| 页面结构 | `boss_platform.mjs`、`boss_chat.mjs` | 平台改版才改适配器并重新验证 |
| 统一结果 | 本轮私有目录 `result.json` | 保存各阶段完成与未完成原因，不用点击数代替结果 |

`growth-unified.json` 仍把三个增长方向合并为一份关键词。`ops-reusable.json` 保留历史运维条件并绑定 6 个示例岗位 ID。两个增长示例岗位与 6 个运维示例岗位可同时进入一个配置计划；也支持只选 1 个或新增更多岗位。重复标题通过不同 ID 区分，重复 ID 绑定两份画像会停止。

历史运维条件中的第一学历不能从卡片最高学历推断。卡片缺证据时保留待复核，不能改成关键词即通过。简历阶段处理的是用户授权的既有会话，不重新用增长条件筛运维会话。

## 配置字段

- `profiles`：一份或多份画像路径，相对于动作配置文件。每个岗位只绑定一个画像。
- `jobIds`：可选，限定画像中的岗位集合；不提供则选择这些画像的全部绑定。
- `actions`：`greet / request / accept` 的有序子集。
- `budgets`：每阶段最多多少真实动作；求/收简历的预算是上限，不能为了用满预算多发。
- `greeting` 或 `greetings[jobId]`：实际平台保存的话术。程序回读，不自动覆盖设置。
- `resumeScope`：`all_history`、`since` 或 `conversation_allowlist`。
- `approval`：只能由本次真实用户授权生成；全部历史需要 `allHistory: true`。示例为空，不可执行。
- `businessDate`：本轮香港日期；实际运行不复用跨日授权。`deadline` 可选，用户未限时则不添加截止要求。
- `controls`：批次、间隔、扫描及复查预算。示例的 5 人、10 秒、120 秒是本地参数，不是官方安全阈值。
- `runtimeFile`：当前电脑的端口、账号标签、依赖路径和状态目录；不放密码或 Cookie。
- `legacyJournal`、`legacyResumeDirectories`：可选，明确指向原业务联系/简历事件记录，接续去重；不清空原台账。

`runDirectory` 必须指向业务私有位置，不把真实进度和会话指纹打进分享包。散列编号不是匿名保证。

`runtime.example.json` 仅示范换机器后的连接字段；实际入口默认使用 `runtime.local.json`。端口与依赖路径由 AI 检查，账号需人亲自登录，不需要提供密码或 Cookie。

## 可运行入口

在本框架目录运行：

```bash
./boss.command plan --authorization examples/ops-role-plan.json
./boss.command plan --authorization examples/growth-role-plan.json
./boss.command plan --authorization examples/multi-role-plan.json
```

以上为纯配置计划，均为 0 次平台动作。真实执行使用本轮新配置，补齐当前授权日期与来源后：

```bash
./boss.command run --authorization /本轮私有目录/run.json --execute
```

只收简历时令 `actions: ["accept"]`，不会重新打招呼或求简历。完整流水线则配三阶段。接收阶段再次调用会重新复查，不沿用旧的“无遗漏”。同一 runId 的预算累计，不重新清零；扩大预算或跨日需新配置与新 runId，联系历史继续共用。

## 合并后的收尾

打招呼的完成判定在发送流程内：回执达到目标、未知为 0、同日同账号官方新增等于本轮确认。权益显示上限变化时记录不可比较，不能拿它相减替代招呼数。

所有阶段都写统一 `result.json`，同时保留阶段详细进度和追加事件。读取完整列表不等于成功请求简历；单批检查完不等于全范围完成；附件卡片消失不等于收到附件。

历史对账会保留校正前副本，使用已保存的官方读回重算剩余。个人实测台账不进入此仓库；新版验证记录只包含验证范围。
