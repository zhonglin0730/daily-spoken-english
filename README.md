# 英语随手练

手机浏览器打开一节约 10 分钟的课。每课有听力、情境对话、跟读短句、背诵短文和换场景开口练习。课后从原文选一个语法点和一处连读，配造句题和跟读步骤。收起短文可按提示复述。已练标记保存在当前设备。

首页从第 1 课开始。展开课程目录可直接选练任何已备好的课，课末用上一课和下一课切换。每日生成的新课加入目录。

## 本地试用

用 Node.js 24 运行 `npm run build`。打开 `dist/preview.html` 可直接试用酒店首课和内置音频。运行 `npm run preview` 可通过终端打印的本地地址检查站点及写入逻辑。预览数据库只在本次进程中保存。

独立 HTML 预览使用酒店首课的原版示例。完整真人录音版使用 `npm run preview` 或 Cloudflare 网站。旧版真人例句的逐条来源、录音作者和许可见 `human-audio.json`。

整课真人录音的课文和来源登记在 `recorded-lessons.json`，每课同时提供完整对话和完整短文两段 MP3。制作时从可重用的原录音中取完整段落，校对英文原文和中文释义，再同步调整语法和连读例句。本站使用的 VOA Learning English 自制录音按其[使用说明](https://learningenglish.voanews.com/p/6861.html)署名，文件存入 `media/recordings/`，构建后由 Cloudflare 静态资源按需提供。现有课程通过日期匹配改编版本，D1 的原始课程记录保留。播放语速可在正常 1 倍和慢速 0.8 倍间切换。

连读区可单独播放对应的真人原声句，语速选择与课页同步。手机长按课文词语，桌面点击词语，可查中文词义、标色和收藏。每个浏览器有自己的标记和生词本。新增录音课时，从对应对话裁出连读原句，并补充 `web/glossary.json` 中的词义。

## Cloudflare Workers 发布

生产配置使用 `daily-spoken-english` D1 数据库和自定义域名 `english.2020453.xyz`。首次部署时执行 `npx wrangler d1 migrations apply DB --remote` 初始化表，再执行 `npx wrangler deploy`。在新账户复用代码时，先替换配置中的数据库 ID 和域名。

在 Cloudflare Worker 的 Builds 设置中连接 GitHub 仓库 `zhonglin0730/daily-spoken-english`，生产分支选 `main`，部署命令填 `npx wrangler deploy`。Wrangler 会按配置构建站点。后续新增 D1 迁移时，在发布依赖新表结构的代码前先应用迁移。

Cloudflare Cron 每天北京时间 07:00 处理当天课程。`recorded-lessons.json` 有当天已校对的两段录音时，定时任务发布该课。音频未齐时，Workers AI 仍可生成文字草稿存入 D1，课程目录在两段录音齐全后才展示。补录后部署会为已有 D1 草稿补齐音频并展示。D1 按日期保存课程，同日重试保留既有版本。生成失败可在 Worker 日志查看原因。

## Sites 发布与每日更新

网站采用 Sites 私有访问。发布后先验证 D1 迁移、移动端登录和首课音频，再通过 Site 提供的课程工具验证无人值守的读写。首次创建站点后把返回的站点 ID 写入 `.openai/hosting.json`，源代码只提交到该站点的专用仓库。

每日任务使用北京时间。先调用 `read_daily_english` 取得日期、今日状态和最近课题。若当天已有课则结束。否则在旅行和 Java 工作沟通之间轮换，生成听力、情境对话、中英跟读、背诵短文、开口题、课后语法和连读练习。优先从酒店、交通、面试自我介绍、日会和确认需求出题。工作情境只用已确认的背景或明确写成演练。调用 `publish_daily_english` 后读回当天课程。同日重试保留先前已写入的版本。

每次更新只写课程数据。建议时刻为北京时间 07:00，待发布及写入验证后创建关联定时任务。
