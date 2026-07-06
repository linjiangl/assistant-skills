# apipost-open-api

Apipost 接口文档管理技能 —— 通过 Apipost Open API 管理项目接口，并导出为 Markdown 接口文档或 OpenAPI 3.0（供前端类型 / SDK 生成）。

适用于 Claude Code 及任何支持 skill 机制的 AI 编程工具（Codex、OpenCode 等）。

## 功能

- **导出接口文档**：把整个 Apipost 项目的接口树 + 详情 + 公共参数渲染成单个 Markdown 文档
- **导出 OpenAPI 3.0**：转换成标准 OpenAPI JSON，前端用 `openapi-typescript` / `openapi-fetch` 自动生成类型与 SDK
- **浏览接口树**：树形层级列出项目中所有接口和目录
- **接口 CRUD**：通过对话创建 / 修改 / 删除接口、目录、文档

## 安装

把本目录拷贝到所用工具的 skills 目录：

```bash
# Claude Code
cp -r apipost-open-api .claude/skills/

# Codex / OpenCode
cp -r apipost-open-api .codex/skills/
```

## 配置

首次使用需要 Apipost 的 Open API Token 和项目 ID：

1. 打开 Apipost 客户端 → 项目设置 → Open API
2. 复制 **Token**（`api_key`）和 **项目 ID**（`project_id`，16 进制雪花 ID）
3. 复制模板并填值：

   ```bash
   cp config.example.json config.json
   ```

   ```json
   {
     "api_key": "你的 Token",
     "project_id": "你的项目 ID"
   }
   ```

`config.json` 含敏感信息，已通过 `.gitignore` 忽略，不会进仓库。

> 也可以不做这步——首次使用时，Claude 会引导你完成配置。

## 快速开始

`<skill>` 指本技能的安装目录。

```bash
# 导出 Markdown 接口文档
node <skill>/scripts/docs-export.js --out docs/api.md

# 导出 OpenAPI 3.0（前端类型 / SDK 生成）
node <skill>/scripts/docs-export.js --format openapi --out docs/openapi.json

# 浏览接口树
node <skill>/scripts/docs-list.js

# 检查配置是否就绪（不输出敏感值）
node <skill>/scripts/docs-check.js
```

或直接对话，例如：

- "把 Apipost 项目的接口文档导出到 docs/api.md"
- "创建一个 POST /api/login 接口"
- "导出 OpenAPI 给前端用"

## 前端消费 OpenAPI

```bash
# 生成 TypeScript 类型
npx openapi-typescript docs/openapi.json -o src/api/types.ts

# 配合 openapi-fetch 得到带类型的请求客户端
npm i openapi-fetch
```

```ts
import createClient from 'openapi-fetch';
import type { paths } from './api/types';

const client = createClient<paths>({ baseUrl: '/api' });
const { data } = await client.POST('/api/login', {
  body: { username: 'test', password: '123456' }, // 路径 / body 全类型推导
});
```

## 文件结构

```
apipost-open-api/
├── SKILL.md               # 给 AI 的完整指令（能力定义、CRUD 示例、安全约束）
├── README.md              # 本文件（人向使用说明）
├── config.example.json    # 配置模板
├── config.json            # 实际配置（你填写，不进仓库）
├── scripts/
│   ├── docs-check.js      # 配置检查（不输出敏感值）
│   ├── docs-list.js       # 接口列表树形展示
│   └── docs-export.js     # 文档导出（Markdown / OpenAPI / 原始 JSON）
└── docs/
    └── open-api.md        # Apipost Open API 完整参考
```

## 更多文档

- [`SKILL.md`](SKILL.md) — 技能的完整指令定义，含接口 CRUD 示例、ad-hoc curl 用法、安全约束
- [`docs/open-api.md`](docs/open-api.md) — Apipost Open API 端点与数据结构完整参考
