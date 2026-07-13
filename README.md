# 网络综合征咨询网页

这是一个本地运行的网页应用，支持 DeepSeek 和通义千问两个模型，并基于已提供的 Cyber-Syndrome PDF 资料做轻量检索增强。

## 运行

```powershell
cd C:\Users\DELL\Documents\日常事务\cyber-syndrome-consult
copy .env.example .env
```

编辑 `.env`，填入：

```text
DEEPSEEK_API_KEY=你的 DeepSeek Key
DASHSCOPE_API_KEY=你的阿里云百炼 Key
QWEN_MODEL=qwen3.7-plus
QWEN_ENABLE_THINKING=false
```

如果你的百炼账号使用业务空间专属域名，把 `QWEN_BASE_URL` 改成控制台对应地址，例如：

```text
QWEN_BASE_URL=https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
```

安装依赖并启动：

```powershell
pnpm install
pnpm start
```

打开终端显示的本地地址。页面右侧会显示手机访问二维码。

## Netlify 部署

本项目已经包含 `netlify.toml`，可以通过 GitHub 导入到 Netlify 部署。

1. 把项目提交到 GitHub。不要提交 `.env`，它已经在 `.gitignore` 中。
2. 在 Netlify 选择 `Add new site` -> `Import an existing project`，选择 GitHub 仓库。
3. Netlify 会自动使用：

```text
Publish directory: public
Functions directory: netlify/functions
```

4. 在 Netlify 的 `Site configuration` -> `Environment variables` 中填写：

```text
DEEPSEEK_API_KEY=你的 DeepSeek Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_THINKING=disabled

DASHSCOPE_API_KEY=你的阿里云百炼 Key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3.7-plus
QWEN_ENABLE_THINKING=false
```

5. 重新部署后，公开网址即可直接访问。公网版本的二维码会指向 Netlify 公开站点本身。

## 资料库

已生成的资料库文件在 `data/cyber_syndrome_knowledge.json`。如果 PDF 内容更新，可重新运行：

```powershell
python scripts/build_knowledge.py
```

## 注意

应用会把 API Key 保留在本机后端，不会写入前端页面。咨询回答用于学习、科普和初步自我梳理，不替代医生、心理咨询师或其他专业人员的诊断与治疗建议。
