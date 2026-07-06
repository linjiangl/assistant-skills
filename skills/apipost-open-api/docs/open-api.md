# Apipost Open API 参考

> 公共结构抽离在顶部,各端点只列差异。所有端点认证走全局 Header `api-token`,Base URL `https://open.apipost.net`。
> 端点格式:`METHOD /open/...`。所有 ID 为 16 进制雪花格式,`parent_id="0"` 表示根目录。

---

## 公共结构

### 通用响应
```json
{ "code": 0, "msg": "成功", "msg_en": "success", "data": {...}, "time": "2024-01-01T00:00:00+08:00" }
```
`code=0` 成功,非 0 失败。`data` 结构因端点而异。

### 项目标识
所有端点用 `project_id` 定位项目;多数端点也接受 `project_code` 二选一,优先 `project_id`。下文各端点为简洁只写 `project_id`。

### 公共错误码
所有写操作可能返回以下错误(各端点不再重复贴):

| code | msg | 含义 |
| --- | --- | --- |
| 14004 | target_id冲突 | target_id 已存在(create)或冲突 |
| 13002 | 项目已被锁定 | 项目管理员或团队超管锁定,无法操作 |
| 14003 | 接口已被锁定 | 单个接口被锁定,无法操作 |
| 14005 | 内容冲突 | 版本冲突(update 专用,`is_force` 可绕过) |

### 公共对象:`request`
`api` / `sse` 类型接口的请求定义:

```json
{
  "auth": { /* 见下「auth 全量结构」 */ },
  "body": {
    "mode": "none|json|form-data|urlencoded|raw|binary",
    "parameter": [ /* parameter 项,form-data 时含 contentType/filename */ ],
    "raw": "",            // mode=raw/json 时的原始字符串
    "raw_parameter": [],  // raw 的结构化参数
    "raw_schema": { "type": "object", "properties": {}, "APIPOST_ORDERS": [], "required": [] },
    "binary": null
  },
  "header":  { "parameter": [ /* parameter 项 */ ] },
  "query":   { "parameter": [ /* parameter 项 */ ] },
  "cookie":  { "parameter": [ /* parameter 项 */ ] },
  "restful": { "parameter": [ /* parameter 项,REST 路径参数 */ ] },
  "pre_tasks": [],   // 前置脚本
  "post_tasks": []   // 后置脚本
}
```

### 公共对象:`parameter` 项
`header` / `query` / `cookie` / `restful` / `body.parameter` 数组每项:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| param_id | string | 参数ID |
| key | string | 参数名 |
| value | string | 参数值 |
| description | string | 描述 |
| field_type | string | 字段类型(string/RegExp...) |
| is_checked | integer | 是否启用 1/-1 |
| not_null | integer | 是否必填 1/-1 |
| contentType | string | (body.parameter) 内容类型 |
| filename | string | (body.parameter) 文件名 |
| schema | object | (folder 继承参数) schema 定义 |
| rules | object | (socket_method) `{common,content_type,custom,fill_type,length,delimiter}` |
| definition / static | string/boolean | (socket_method) 定义与是否静态 |

### 公共对象:`auth` 全量结构
`request.auth.type` 决定生效的认证类型,其余类型对象可留空但建议保留结构:

| type | 字段 |
| --- | --- |
| noauth | (无字段) |
| inherit | 继承父级/folder,无需配置 |
| kv | `kv:{key,value}` |
| bearer | `bearer:{key}` |
| basic | `basic:{username,password}` |
| digest | `digest:{username,password,realm,nonce,algorithm,qop,nc,cnonce,opaque}` |
| hawk | `hawk:{authId,authKey,algorithm,user,nonce,extraData,app,delegation,timestamp,includePayloadHash}` |
| awsv4 | `awsv4:{accessKey,secretKey,region,service,sessionToken,addAuthDataToQuery}` |
| ntlm | `ntlm:{username,password,domain,workstation,disableRetryRequest}` |
| edgegrid | `edgegrid:{accessToken,clientToken,clientSecret,nonce,timestamp,baseURi,headersToSign}` |
| oauth1 | `oauth1:{consumerKey,consumerSecret,signatureMethod,addEmptyParamsToSign,includeBodyHash,addParamsToHeader,realm,version,nonce,timestamp,verifier,callback,tokenSecret,token,disableHeaderEncoding}` |
| oauth2 | `oauth2:{addTokenTo,access_token,headerPrefix,grant_type,redirect_uri,authUrl,accessTokenUrl,clientId,clientSecret,challengeAlgorithm,scope,state,client_authentication,refreshTokenUrl,authRequestParams,tokenRequestParams,refreshRequestParams}` |
| jwt | `jwt:{addTokenTo,algorithm,secret,isSecretBase64Encoded,payload,headerPrefix,queryParamKey,header}` |
| asap | `asap:{alg,iss,aud,kid,privateKey,sub,claims,exp}` |

### 公共对象:`response`
```json
{
  "example": [
    {
      "example_id": "1",
      "raw": "",              // 响应原始内容
      "raw_parameter": [],     // 结构化参数
      "headers": [],           // (graphql/socket_method) 响应头
      "expect": {
        "name": "成功",
        "is_default": 1,       // 1 默认 -1 非默认
        "code": "200",         // HTTP 状态码
        "content_type": "json",
        "verify_type": "schema",
        "mock": "",
        "schema": { "type": "object", "properties": {}, "APIPOST_ORDERS": [], "required": [] },
        "sleep": 0             // (socket_method) 响应延时毫秒
      }
    }
  ],
  "is_check_result": 1
}
```
> **字段命名差异**:请求体(create/update)用下划线 `is_default`/`content_type`/`verify_type`;响应返回用驼峰 `isDefault`/`contentType`/`verifyType`。创建时传下划线。
> **结构差异**:create/update 的 `example` 是**数组**;`details` 返回的 `example` 是**对象**(以 example_id 为 key)。

### 公共响应字段:`data`
create/update 返回的 `data`(单个对象)与 list/details 的 `data.list[]` 每项共享以下字段:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| target_id | string | 资源ID |
| project_id | string | 项目ID |
| parent_id | string | 父目录ID,"0" 为根 |
| target_type | string | 见下「target_type 速查」 |
| name | string | 名称 |
| version | integer | 版本号 |
| sort | integer | 正序排序 |
| mark_id | string | 完成状态:1开发中 2已完成 3需修改 |
| method | string | (api/sse/socket) 请求方式 |
| url | string | (api/sse/socket) 请求地址 |
| protocol | string | (api) http/1.1 |
| description | string | 说明 |
| request | object | (api/sse/graphql/websocket) 请求定义 |
| response | object | (api/sse/graphql/socket_method) 响应定义 |
| message | array | (websocket2/socketio) 消息定义 |
| config | object | (websocket2/socketio) 连接配置 |
| attribute_info | object | 自定义属性(自由 key-value) |
| tags | array | 标签数组 |
| server_id | string | (folder) 服务ID,"0" 继承父级 |
| created_at | string | 创建时间 |
| created_user | object | `{uid,nick_name,portrait}` |
| updated_at | string | 更新时间 |
| updated_user | object | `{uid,nick_name,portrait}` |
| status | integer | 状态 |
| is_locked | integer | 是否锁定 -1/0/1 |

### target_type 速查

| 值 | 含义 |
| --- | --- |
| api | HTTP 接口 |
| folder | 目录 |
| doc | Markdown 文档 |
| sse | SSE 接口 |
| graphql | GraphQL 查询 |
| websocket2 | WebSocket 连接 |
| socketio | Socket.IO 会话 |
| socket | TCP 客户端 |
| socket_method | TCP 方法(挂在 socket 下) |

---

## 端点

### 1. 接口列表(简约结构)
`GET /open/apis/list?project_id={project_id}`

Query:`project_id`(或 `project_code`,二选一)。

响应 `data.list[]` 简约结构,每项含 `target_id`/`target_type`/`parent_id`/`name`/`version`/`method`/`url`/`mark_id`/`sort`/`is_exampled`,**不含** request/response 详情。

> 浏览接口树推荐用 `docs-list.js` 脚本,无需直接调用此端点。

### 2. 创建接口 / 目录 / 文档
`POST /open/apis/create`

#### 公共请求字段(所有 target_type)

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| project_id | 是 | 项目ID(或 project_code) |
| target_type | 是 | 见速查表 |
| parent_id | 否 | 默认 "0"(根) |
| name | 是 | 名称 |
| mark_id | 否 | 默认 "1" |
| description | 否 | 说明 |
| tags | 否 | 标签数组 |

各 target_type 差异如下(仅列与公共字段的差异,auth/body/header 等通用结构见上方公共对象):

#### `api`(HTTP) / `sse`
额外:`method`(HTTP 必填)、`url`、`protocol`(默认 http/1.1)、`request`(见公共对象)、`response`(见公共对象)。sse 结构与 api 相同,仅 target_type 不同。

> 完整示例见 `SKILL.md`「创建一个 HTTP 接口」。

#### `folder`(目录)
仅 `project_id` + `name`(+可选 `parent_id`/`server_id`/`description`)。**无** method/url/request/response。
`server_id`:服务ID,"0" 继承父级。folder 可在 `request` 里定义继承给子接口的参数(header/query/body/cookie/auth),其 `auth.type` 常用 `inherit`。

#### `doc`(Markdown 文档)
仅 `project_id` + `name`(+可选 `parent_id`/`mark_id`/`description`/`tags`)。**无** request/response。

#### `graphql`
额外:`url`、`request.auth`(常用 `inherit`)、`request.body`:
```json
{
  "query_schema": {},
  "query_list": [
    {
      "param_id": "...",
      "name": "自定义查询",
      "query": "",
      "variables": "",
      "response": { "mode": "json", "raw": "", "raw_parameter": [], "raw_schema": {"type":"object"} }
    }
  ]
}
```
`request` 含 `cookie`/`header`/`pre_tasks`/`post_tasks`(无 query/restful)。`response.example` 结构同公共对象。

#### `websocket2`(WebSocket 连接)
额外:`url`、`request`(仅 `cookie`/`header`/`query`,无 body/auth/restful)、`message[]`、`config`:
```json
{
  "message": [
    {
      "name": "消息",
      "param_id": "...",
      "request":  { "mode": "text", "raw": "", "raw_parameter": [], "raw_schema": {"type":"object"} },
      "response": { "mode": "text", "raw": "", "raw_parameter": [], "raw_schema": {"type":"object"} }
    }
  ],
  "config": {
    "certificate_verification": -1,
    "information_size": 5,
    "reconnect_num": 5,
    "reconnect_time": 5000,
    "shake_hands_timeout": 0
  }
}
```

#### `socketio`(Socket.IO 会话)
同 websocket2,`request` 增加 `event.parameter[]`(事件参数,见公共 parameter 项)。`config` 增加 `shake_hands_path`(默认 `/socket.io`)、`socket_version`(默认 `v4`)。

#### `socket`(TCP 客户端)
额外:`method:"TCP"`、`url`、`request`(无 auth/body/header/query):
```json
{ "timeout": 10, "end_func": { "name": "none", "option": "" } }
```

#### `socket_method`(TCP 方法)
`parent_id` 指向所属 socket。`method:"TCP"`。`request`:
```json
{
  "body": {
    "mode": "xml",
    "parameter": [ /* parameter 项,socket_method 项含 rules/definition/static */ ],
    "raw": "",
    "raw_parameter": [],
    "raw_schema": { "type": "object" }
  },
  "post_tasks": [],
  "configs": { "charset": "utf8", "func": { "request": [], "response": [] } }
}
```
`response.example` 结构同公共对象,`expect` 增加 `sleep`(延时毫秒)。

#### create 错误
见公共错误码 14004 / 13002 / 14003。

---

### 3. 获取多条接口详情
`POST /open/apis/details`

Body:`project_id` + `target_ids`(数组)。

响应 `data.list[]`,每项为对应 target_type 的完整对象(结构同 create 响应,含完整 request/response)。folder 项可能含 `script{pre_script,pre_script_switch,test,test_switch}` 字段。

> 拉取详情推荐用 `docs-export.js`(批量拉取并渲染为 Markdown),或直接 curl。

### 4. 修改接口
`POST /open/apis/update`

**整体覆盖,非局部合并**:未传字段会被清空(置默认值)。必须先调 `/open/apis/details` 取完整数据,在此基础上修改后整体提交。

Body 与 create 一致,额外:

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| target_id | 是 | 要修改的资源ID |
| is_force | 否 | 1 强行覆盖版本冲突;默认不强制 |

update 专用错误:`14005 内容冲突`(版本冲突,见公共错误码)。

### 5. 批量删除
`POST /open/apis/delete`

Body:`project_id` + `target_ids`(数组)。删目录会**级联删除**所有子项。

响应 `data.list[]`:`{target_id, version}`(被删元素列表)。

### 6. 更新接口状态
`POST /open/apis/multi_up_mark`

Body:`project_id` + `mark_id`(`1`开发中 / `2`已完成 / `3`需修改)+ `target_ids`(数组)。
