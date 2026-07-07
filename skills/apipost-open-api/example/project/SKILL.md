---
name: project-api-docs
description: Use when modifying project API routes, controllers, request validation, or API response structures that may require Apipost documentation updates.
---

# Project API Docs

## 何时使用
- 新增或修改项目 API 路由。
- 新增或修改 Controller、Request 校验或接口响应结构。
- 项目 API 代码完成后，需要确认是否同步 Apipost 接口文档。

## 核心流程
1. 从代码确认接口信息：请求方法、完整路径、鉴权方式、Request 校验规则、成功响应和关键业务错误。
2. 接口代码写完后，先询问用户是否同步 Apipost 文档；用户未确认前不要创建或更新文档。
3. 如果用户已经明确要求更新、同步、生成接口文档，则视为已确认，直接执行同步流程。
4. 用户确认后，同时使用 `apipost-open-api` skill 执行 Apipost 侧操作；具体脚本、删除、创建、更新和验证流程以该 skill 为准。
5. 本 skill 只提供项目 API 的接口识别、目录组织和接口规格编写规则。

## 规格约定
- `folder`：目录名；多级目录用 `/` 分隔。
- `method + url`：用于判断更新已有接口还是创建新接口。
- 更新已有接口时必须写完整 `params` 和 `responseParams`，不要只写本次变更字段。
- 公开接口使用 `auth: "noauth"`；登录态接口使用 `auth: "bearer"`。
- `params` 必须写字段名、类型、是否必填、示例值、说明。
- `GET` 参数写 `params`，脚本会放到 Apipost Query。
- 路径参数写 `pathParams` 或 `restfulParams`，不要写进 `params`；例如 `/api/items/{id}` 的 `id` 写 `pathParams`。
- `between` 日期范围这类 `GET` 查询优先使用逗号分隔字符串，例如 `date=2026-07-01,2026-07-31`，便于 Apipost 直接测试。
- 非 `GET` 参数写 `params`，脚本会放到 Apipost Body form-data。
- `responseParams` 必须写字段名、类型、是否必填、示例值、说明。
- 不要写 `responseExample`；有的接口响应体太大，维护完整 `responseParams` 即可。
- 参数说明优先从 Request 的 `rules()` / `attributes()`、Controller 入参、Service 返回结构和测试断言里提取。
- 不要把 Apipost token 输出到对话、命令参数或仓库文件。

## 验证要求
- 必须按 `apipost-open-api` skill 的当前流程查看 Apipost 目录树。
- 字段级变更至少确认 Apipost 文档已创建或更新；必要时导出文档或查看详情确认参数内容。
- 确认接口位于正确目录，且请求方法和路径正确。
- 只改本文档流程时无需运行应用测试。

## 最小规格结构
```json
{
  "folder": "父目录/子目录",
  "name": "接口名称",
  "method": "GET",
  "url": "/api/example/items",
  "auth": "bearer",
  "description": "接口说明",
  "pathParams": [],
  "params": [
    {"key":"keyword","type":"string","required":false,"value":"demo","description":"搜索关键词"}
  ],
  "responseParams": [
    {"key":"records","type":"array","required":true,"value":"[]","description":"列表数据"},
    {"key":"records.id","type":"integer","required":true,"value":"1","description":"记录 ID"}
  ]
}
```
