# 本机只读框架

`boss.command` 是统一入口。双击它仅预检；只读参数支持 doctor、jobs、preview、switch-trial。实际执行使用 `run --authorization 本轮配置 --execute`，详见 [发送说明](live-greet.md)。本页命令均不发送。

## BOSS 怎么打开

1. 双击本包 `open-boss.command`。现有端口 53470 可连接时不改变页面；没有时打开一个普通 Chrome 独立会话，需要用户亲自登录。新会话使用自己的资料目录，不复制登录 Cookie。新会话登录分支尚未实测。
2. 登录本人已授权的招聘账号，保留唯一一个 BOSS 网页标签。运行 `doctor / jobs / preview / switch-trial` 时打开 `https://www.zhipin.com/web/chat/recommend` 的“推荐牛人”；统一 `run` 可从已登录的正常页面开始，程序按阶段进入推荐、日报或沟通页。
3. 保持电脑唤醒、Chrome 和网络可用；运行期间不要操作 BOSS，停止旧打招呼程序。登录页、验证码页、403 或 BOSS 原生客户端不能作为运行条件。
4. 打招呼真实目标岗位必须出现在推荐页的可读取下拉列表，有唯一岗位 ID 和完整标签；简历阶段则核对实际会话岗位。程序按配置切换，不要求人工预先选好。

普通浏览器里能看到 BOSS，不等于本框架可连接。框架需要可连接的 Chrome 调试端口。既有试验是在正常显示的 Chrome 页面完成的；没有验证最小化、锁屏、休眠、浏览器关闭后恢复、验证码之后恢复或未来定时无人值守。不需要提供密码或 Cookie。

## 一次一条命令

先按 README 安装依赖并生成 runtime.local.json，再在本 Skill 目录执行：

```bash
./boss.command doctor
```

成功信号：`ok: true`，账号标签符合预期、推荐页就绪，无风险提示。它只表示可读取，不表示可发送。

读取深圳前 10 张推荐卡并直接输出关键词计划：

```bash
./boss.command preview --profile profiles/growth-unified-shenzhen.json --limit 10
```

试验切到厦门并在成功读取后回到原岗位：

```bash
./boss.command switch-trial --profile profiles/growth-unified-xiamen.json --limit 10
```

关注 `matchPlan.counts`、`matchedKeywords`、`messageClicks: 0`、`finalJob`。`rejected` 在当前规则下仅指“当前卡片未命中关键词”，不是能力不合格。卡片无法提取时 `needs_review`，不能假装读到了完整简历。

需要留存运行证据时加 `--out` 指定业务私有文件路径；其中含人选职业自述，勿放入分享包。普通 SHA256 编号不是匿名保证。程序不翻页、不打开简历、不滚动加载、不保存密码，不直接调用私有平台接口。

## 配置怎么换

同一岗位族可共用一份规则：增长的两个绑定文件通过 `screeningProfile` 引用 `profiles/growth-unified.json`，无需维护两套画像。新岗位族另建配置，具体见 [多岗位配置](multirole.md)。匹配层不用改代码；新岗位需用 `jobs` 读取真实 ID／标签再绑定。规则 hash 不包含岗位绑定，便于核对同规则；适配器 hash 单独记录。

页面改版时调整对应适配器并重新验证。`runtime.local.json` 是这台电脑的路径、端口和账号标签，换机器后需要对应本机依赖位置与本人登录。Node.js、Python 3、puppeteer-core 必须可用；发布版通过本仓库 npm 依赖安装 puppeteer-core，不加载旧 CLI 的守卫。

只读会话状态在 `~/Library/Application Support/boss-framework/`：新程序锁不能全面阻止人工或其他旧程序。风险停止写入 `halt.json` 后不自动恢复；先查明平台状态与停止原因，再由人明确恢复。它不是平台解除限制的方法。

## 已完成的接入与剩余限制

- 人类决定：本轮新增上限、具体岗位、话术、是否限制时间；确认薪酬、地点及用工条件的公开表述。
- 已实现：实际保存话术回读、UI 操作、关联回执、跨岗位联系去重、开轮余额约束、未知隔离和结束对账。实际完成数以本轮进度与官方读回为准。
- 新版已将岗位数量、话术和画像改成配置输入；新增角色须核对真实 ID、标签和字段证据。新版简历模块未真实试验，不能承诺任意页面即改即用或长期不封号。程序锁无法锁住人工或不遵守锁的其他程序。

用户已经确定统一关键词触达标准，不需重新确认三个画像或第一学历规则。JD、已找到的岗位 ID、关键词提取和技术端口可由 AI 核对；不要让人重复提供。
