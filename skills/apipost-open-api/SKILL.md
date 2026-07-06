---
name: apipost-open-api
description: Apipost 接口文档管理工具。通过 Open API 管理项目中的接口、目录、文档等资源，并支持导出为 Markdown 接口文档或 OpenAPI 3.0（供前端自动生成 TypeScript 类型 / 请求 SDK）。当用户提到 Apipost、接口文档、API 文档同步/导出、生成 OpenAPI、前端类型生成等相关操作时使用此技能。
---

# Apipost Open API Skill

通过 Apipost 开放接口管理项目中的接口（API）、目录（Folder）、文档（Doc）等资源，并支持将整个项目导出为 Markdown 接口文档或 OpenAPI 3.0（供前端自动生成类型与 SDK）。

## 基础信息

- **Base URL**: `https://open.apipost.net`（已内置在脚本中，无需配置）
- **认证方式**: 所有请求通过 `api-token` Header 认证
- **project_id**: 16进制雪花ID，从 Apipost 客户端 → 项目设置 → Open API 获取

## 配置

配置写在 skill 包根目录的 `config.json`（与 `SKILL.md` 同级），仅两个字段：

```json
{
  "api_key": "你的 Open API Token",
  "project_id": "你的项目ID（16进制雪花）"
}
```

模板见同目录的 `config.example.json`。脚本通过 `__dirname` 定位此文件，因此 skill 装在哪都能找到配置，不依赖用户主目录或固定路径。

> 下文用 `<skill>` 代指本 skill 的安装目录。调用脚本时按实际安装路径拼接即可，例如 `node <skill>/scripts/docs-export.js`。

### 首次配置引导

当用户需要使用本技能但 `config.json` 缺失或不完整时，按以下步骤引导：

1. 询问用户索取 **api_key**（Apipost 客户端 → 项目设置 → Open API → Token）和 **project_id**（同页面的项目ID）。
2. 用 Write 工具创建 `<skill>/config.json`，写入上述两个字段。
3. 运行检查脚本确认就绪（不输出任何敏感值）：

```bash
node <skill>/scripts/docs-check.js
```

4. 检查不通过则提示用户补全对应字段后再继续。

**安全约束**：不要在任何输出、命令可见参数或提交中明文展示 `api_key`。脚本内部使用该值，不会打印。需要 ad-hoc curl 时，用下文「从配置加载到 shell 变量」的方式，避免把 token 写进命令行参数。

## 技能文件结构

```
<skill>/
├── SKILL.md                     # 本文件
├── config.example.json          # 配置模板
├── config.json                  # 实际配置（agent 写入，不进仓库）
├── scripts/
│   ├── docs-check.js            # 配置检查（不输出值）
│   ├── docs-list.js             # 接口列表树形展示
│   └── docs-export.js           # 项目接口文档导出（Markdown / OpenAPI / 原始 JSON）
└── docs/
    └── open-api.md            # API 完整参考文档
```

## 从配置加载到 shell 变量（ad-hoc curl 用）

需要直接 curl 调用接口（创建/修改/删除等）时，从 `config.json` 把值加载进 shell 变量，**不要把 token 硬编码进命令**。agent 已知 skill 的实际安装路径（下文 `<skill>`），直接用该路径加载：

```bash
eval "$(node -e 'const c=require("<skill>/config.json");console.log("export APIPOST_API_KEY="+JSON.stringify(c.api_key)+";export APIPOST_PROJECT_ID="+JSON.stringify(c.project_id))')"

curl -s -H "api-token: $APIPOST_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"'"$APIPOST_PROJECT_ID"'",...}' \
  'https://open.apipost.net/open/apis/create'
```

`eval` 在 shell 内消费 export 语句，token 不会出现在 Bash 工具捕获的 stdout 中。

## 核心能力一：生成项目接口文档（推荐）

将整个 Apipost 项目的接口树 + 详情 + 项目级公共参数渲染成**单个 Markdown 文档**。脚本在进程内完成渲染，避免把巨量 details JSON 灌进对话（省 Token）。

```bash
# 默认导出到当前目录 apipost-api-docs.md
node <skill>/scripts/docs-export.js

# 指定输出路径
node <skill>/scripts/docs-export.js --out docs/api.md

# 仅导出目录树结构，不拉取每个接口详情（更快，用于概览）
node <skill>/scripts/docs-export.js --no-details

# 导出 OpenAPI 3.0 JSON（供前端类型/SDK 生成，见「核心能力三」）
node <skill>/scripts/docs-export.js --format openapi
node <skill>/scripts/docs-export.js --format openapi --out docs/openapi.json

# 导出原始 JSON 结构（便于程序处理）
node <skill>/scripts/docs-export.js --json --out apipost.json
```

脚本流程：`/open/apis/list` 建树 → 分批 `/open/apis/details` 拉取每个接口完整数据 → `/open/project/global/param/details` 拉取公共参数 → 渲染 Markdown（含目录锚点、请求/响应参数表、响应示例、字段说明）。

输出末尾会打印简短摘要（项目名、目录/接口数、已拉取详情数），不含敏感信息。

## 核心能力二：浏览接口树

**浏览、查找、列出接口时，优先使用 `docs-list.js`**，不要直接 curl 调 list 接口。脚本把扁平 JSON 组织成树形层级，包含每个目录和接口的 `[target_id]`，比拿一大段 JSON 节省 Token 且更清晰。

```bash
node <skill>/scripts/docs-list.js
node <skill>/scripts/docs-list.js --json
node <skill>/scripts/docs-list.js --save tree.json
```

只有需要获取接口的完整请求/响应详情时，才调用 `/open/apis/details`。

## 核心能力三：导出 OpenAPI（供前端）

把 Apipost 项目转换成 **OpenAPI 3.0 JSON**，前端工具链可直接消费，自动生成 TypeScript 类型、请求 SDK、Mock 数据，无需手抄接口定义。

```bash
node <skill>/scripts/docs-export.js --format openapi --out docs/openapi.json
```

### 前端消费示例

**生成 TypeScript 类型**（配合 `openapi-typescript`）：

```bash
npx openapi-typescript docs/openapi.json -o src/api/types.ts
```

```ts
import type { paths } from './api/types';
type LoginBody = paths['/api/login']['post']['requestBody']['content']['application/json'];
//   ^? { username: string; password: string }
```

**生成带类型的请求客户端**（配合 `openapi-fetch` 或 `swagger-typescript-api`）：

```bash
npx openapi-typescript docs/openapi.json -o src/api/types.ts
npm i openapi-fetch
```

```ts
import createClient from 'openapi-fetch';
import type { paths } from './api/types';

const client = createClient<paths>({ baseUrl: '/api' });
// 路径、method、query/body 全部类型推导 —— 写错字段编译期报错
const { data, error } = await client.POST('/api/login', {
  body: { username: 'test', password: '123456' },
});
```

### 转换规则

| Apipost | OpenAPI 3.0 |
| --- | --- |
| `api` 类型 | paths 下的 operation |
| 目录 (folder) | operation 的 `tags`（取直接父目录名） |
| URL `:id` 风格路径参数 | `{id}`，并转成 `in: path` 参数（必填） |
| `request.header/query/restful` 的 parameter[] | parameters（header/query/path） |
| body `json`/`raw` 的 schema | 三级回退：① `raw_schema`（有实质 properties 时）② `raw_parameter`（点路径展开为嵌套）③ 从 `raw` 反推 |
| body `form-data` / `urlencoded` | `multipart/form-data` / `application/x-www-form-urlencoded`，schema 由 parameter[] 点路径展开 |
| `response.example[].expect.schema` | 响应 schema，同样三级回退（`expect.schema` → `raw_parameter` → 无） |
| `response.example[].raw` | 响应 example（自动解析 JSON） |
| 嵌套字段（如 `data.access_token`） | `raw_parameter` 的 key 用点路径表示，导出时展开为嵌套 object schema |
| 项目级公共参数 `global_param.header/query` | 并入每个 operation（接口同名参数优先） |
| 公共/接口认证 `bearer` / `basic` | `securitySchemes` + `security`；接口 `noauth` 用空 `security: []` 显式排除 |

> **关于 schema 来源**：Apipost 实际数据中，`raw_schema` / `expect.schema` 常是空占位 `{"type":"object"}`，接口字段真正存放在 `raw_parameter` 数组里（每项含 `key`/`field_type`/`schema`/`not_null` 等）。导出脚本会自动按上述优先级回退，无需手动处理。点路径 key（`a.b.c`）会被展开为嵌套 object，因此前端生成的类型会是 `data?: { access_token: string }` 而非扁平的 `"data.access_token": string`。

### 局限

- **仅 REST**：`sse` / `graphql` / `websocket2` / `socketio` / `socket` / `socket_method` / `doc` 不进 OpenAPI（OpenAPI 不支持非 REST 协议），导出时计数告知。需要 WebSocket/GraphQL 的类型时，用 Markdown 或 `--json` 导出后单独处理。
- **认证仅 bearer/basic**：digest/oauth2/hawk/awsv4 等异类认证不映射（导出不报错，但该项不生成 security）。
- **仅 JSON 输出**：脚本坚持仅用 Node 内置模块，不引 YAML 依赖。需要 YAML 用 `npx @redocly/cli` 等工具转换。

## 核心接口

详细的请求/响应参数请查阅 `<skill>/docs/open-api.md`。

### 1. 获取接口列表（一般用 docs-list 脚本代替）

```
GET https://open.apipost.net/open/apis/list?project_id={project_id}
```

返回项目中所有接口和目录的简约结构列表，每项含 `target_id`、`target_type`、`parent_id`、`name`、`method`、`url`、`sort`。

- `target_type`: `api`(HTTP接口)、`folder`(目录)、`doc`(Markdown文档)、`sse`、`graphql`、`websocket2`、`socketio`、`socket`(TCP客户端)、`socket_method`(TCP方法)
- `parent_id` 为 `"0"` 表示根目录

### 2. 创建接口/目录

```
POST https://open.apipost.net/open/apis/create
```

Body 关键参数：`project_id`、`target_type`（`api`/`folder`/`doc`/`sse`/`graphql`/`websocket2`/`socketio`/`socket`/`socket_method`）、`parent_id`（默认`"0"`）、`name`、`method`（HTTP必填）、`url`、`description`、`request`、`response`、`tags`。创建目录只需 `target_type:"folder"` + `name` + `project_id`。

`request`/`response` 的完整对象结构见 `<skill>/docs/open-api.md`（auth 全量字段、各 body 模式参数位置、response.example 结构等）。

### 3. 修改接口

```
POST https://open.apipost.net/open/apis/update
```

**重要：update 是整体覆盖，不是局部合并！** 未传字段会被清空。修改时必须传完整数据：

1. 必传：`project_id`、`target_id`、`target_type`、`name`、`method`
2. 需保留的 `url`/`parent_id`/`description`/`request`/`response` 等必须一并传入
3. 正确做法：先用 `/open/apis/details` 获取当前完整数据，在此基础上修改后提交

### 4. 批量删除接口

```
POST https://open.apipost.net/open/apis/delete
```

Body: `project_id` + `target_ids`（数组）。删除目录会级联删除其下所有子项。

### 5. 获取多条接口详情

```
POST https://open.apipost.net/open/apis/details
```

Body: `project_id` + `target_ids`（数组）。返回完整 `request`/`response`/`description`。

## 通用响应格式

所有接口返回 `{"code": 0, "msg": "成功", "data": {...}}`，`code=0` 代表成功，非0代表失败。

## 典型操作示例

### 生成接口文档

```bash
node <skill>/scripts/docs-export.js --out docs/api.md
```

### 创建一个 HTTP 接口

```bash
eval "$(node -e 'const c=require("<skill>/config.json");console.log("export APIPOST_API_KEY="+JSON.stringify(c.api_key)+";export APIPOST_PROJECT_ID="+JSON.stringify(c.project_id))')"

curl -s -X POST \
  -H "api-token: $APIPOST_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id": "'"$APIPOST_PROJECT_ID"'",
    "target_type": "api",
    "parent_id": "0",
    "name": "用户登录",
    "method": "POST",
    "url": "/api/login",
    "description": "用户登录接口",
    "request": {
      "auth": {"type": "noauth"},
      "body": {"mode": "json", "raw": "{\"username\":\"test\",\"password\":\"123456\"}", "parameter": [], "raw_parameter": [
        {"param_id":"xxx","key":"username","value":"test","description":"用户名","field_type":"string","is_checked":1,"not_null":1},
        {"param_id":"xxx","key":"password","value":"123456","description":"密码","field_type":"string","is_checked":1,"not_null":1}
      ]},
      "header": {"parameter": []},
      "query": {"parameter": []},
      "restful": {"parameter": []}
    },
    "response": {
      "example": [{"example_id":"1","raw":"","expect":{"name":"成功","is_default":1,"code":"200","content_type":"json","verify_type":"schema","mock":"","schema":{}}}]
    }
  }' \
  'https://open.apipost.net/open/apis/create'
```

### 创建一个目录

```bash
eval "$(node -e 'const c=require("<skill>/config.json");console.log("export APIPOST_API_KEY="+JSON.stringify(c.api_key)+";export APIPOST_PROJECT_ID="+JSON.stringify(c.project_id))')"

curl -s -X POST \
  -H "api-token: $APIPOST_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"'"$APIPOST_PROJECT_ID"'","target_type":"folder","name":"用户模块"}' \
  'https://open.apipost.net/open/apis/create'
```

## 注意事项

- 所有ID都是16进制雪花ID格式，`parent_id` 默认 `"0"`（根目录）
- 删除目录会级联删除其下所有子接口和子目录
- 修改接口是整体覆盖，必须先获取完整数据再修改后提交
- **生成文档用 `docs-export.js`，浏览用 `docs-list.js`**，二者均在进程内读取 `config.json`，不把 token 暴露给对话
- ad-hoc curl 用「从配置加载到 shell 变量」的方式，不要硬编码 token
