#!/usr/bin/env node
'use strict';

/**
 * Apipost 项目接口文档导出工具（Node.js，仅用内置模块）
 *
 * 从 skill 包内的 config.json 读取配置（api_key / project_id），调用开放接口
 * 拉取项目接口列表 + 详情 + 全局参数，渲染成单个 Markdown 文档。
 *
 * 用法（<skill> 指本 skill 的安装目录）:
 *   node <skill>/scripts/docs-export.js
 *   node <skill>/scripts/docs-export.js --out docs/api.md
 *   node <skill>/scripts/docs-export.js --no-details
 *   node <skill>/scripts/docs-export.js --json
 *   node <skill>/scripts/docs-export.js --format openapi [--out openapi.json]
 *
 * 输出形态:默认 Markdown; `--format openapi` 输出 OpenAPI 3.0 JSON(供前端类型/SDK 生成);
 * `--json` 输出 Apipost 原始 JSON 结构。
 *
 * api_key 在进程内使用，不会打印到输出。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// 配置文件位于 skill 包根目录（与本文件 ../ 同级），随项目走、不依赖用户主目录
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const HOST = 'https://open.apipost.net';
const DEFAULT_OUT = 'apipost-api-docs.md';
const DETAILS_BATCH = 50; // /open/apis/details 单次 target_ids 稳妥上限

// ---------------- config ----------------

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    die(`配置文件不存在: ${CONFIG_PATH}\n请先让 agent 完成首次配置（复制 config.example.json 为 config.json 并填值）。`);
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    die(`配置 JSON 解析失败: ${CONFIG_PATH}\n${e.message}`);
  }
  const missing = ['api_key', 'project_id'].filter((k) => {
    const v = String(cfg[k] != null ? cfg[k] : '').trim();
    return !v || v === '""' || v === "''";
  });
  if (missing.length) {
    die(`配置缺少必填字段: ${missing.join(', ')}\n请在 ${CONFIG_PATH} 补全。`);
  }
  return cfg;
}

// ---------------- http ----------------

function request(cfg, urlPath, body, isPost) {
  return new Promise((resolve, reject) => {
    const u = new URL(HOST + urlPath);
    const lib = u.protocol === 'https:' ? https : http;
    const headers = { 'api-token': cfg.api_key };
    let data;
    if (isPost) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const req = lib.request(u, { method: isPost ? 'POST' : 'GET', headers }, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(chunks);
        } catch (e) {
          return reject(new Error(`JSON 解析失败 [${urlPath}]: ${e.message}`));
        }
        if (payload.code !== 0) {
          return reject(new Error(`API 错误 [${urlPath}]: ${payload.msg} (code=${payload.code})`));
        }
        resolve(payload.data);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const apiGet = (cfg, p) => request(cfg, p, null, false);
const apiPost = (cfg, p, body) => request(cfg, p, body, true);

// ---------------- 数据拉取 ----------------

async function fetchProjectInfo(cfg) {
  try {
    return (await apiGet(cfg, `/open/project/info?project_id=${cfg.project_id}`)) || {};
  } catch {
    return {};
  }
}

async function fetchGlobalParam(cfg) {
  try {
    return (await apiGet(cfg, `/open/project/global/param/details?project_id=${cfg.project_id}`)) || {};
  } catch {
    return {};
  }
}

async function fetchList(cfg) {
  const data = (await apiGet(cfg, `/open/apis/list?project_id=${cfg.project_id}`)) || {};
  return Array.isArray(data.list) ? data.list : [];
}

async function fetchDetails(cfg, ids) {
  const result = {};
  for (let i = 0; i < ids.length; i += DETAILS_BATCH) {
    const chunk = ids.slice(i, i + DETAILS_BATCH);
    const data = (await apiPost(cfg, '/open/apis/details', {
      project_id: cfg.project_id,
      target_ids: chunk,
    })) || {};
    for (const item of (data.list || [])) {
      if (item.target_id) result[item.target_id] = item;
    }
  }
  return result;
}

// ---------------- 建树 ----------------

function buildTree(items) {
  const nodes = {};
  const roots = [];
  for (const item of items) {
    const tid = item.target_id;
    if (!tid) continue;
    nodes[tid] = {
      target_id: tid,
      target_type: item.target_type || '',
      name: item.name || '',
      method: item.method || '',
      url: item.url || '',
      sort: item.sort || 0,
      parent_id: item.parent_id || '0',
      children: [],
    };
  }
  for (const item of items) {
    const tid = item.target_id;
    if (!tid) continue;
    const pid = item.parent_id || '0';
    if (pid === '0' || pid === '' || pid == null) {
      roots.push(nodes[tid]);
    } else if (nodes[pid]) {
      nodes[pid].children.push(nodes[tid]);
    }
  }
  const sortFn = (a, b) => (a.sort - b.sort) || String(a.name || '').localeCompare(String(b.name || ''));
  const sortRec = (n) => {
    n.children.sort(sortFn);
    n.children.forEach(sortRec);
  };
  roots.sort(sortFn);
  roots.forEach(sortRec);
  return roots;
}

// ---------------- 防御性取值 ----------------

function asParams(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  if (typeof obj === 'object') {
    if (Array.isArray(obj.parameter)) return obj.parameter;
    return [];
  }
  return [];
}

function asExampleList(resp) {
  if (!resp || typeof resp !== 'object') return [];
  const ex = resp.example;
  if (!ex) return [];
  if (Array.isArray(ex)) return ex;
  if (typeof ex === 'object') return Object.values(ex);
  return [];
}

function bodyInfo(request) {
  const body = (request || {}).body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return { mode: body.mode || 'none', body };
  }
  if (Array.isArray(body)) {
    return { mode: 'form-data', body: { parameter: body, mode: 'form-data' } };
  }
  return { mode: 'none', body: {} };
}

function expectField(ex, ...names) {
  const expect = (ex && ex.expect) || {};
  for (const n of names) if (n in expect) return expect[n];
  return '';
}

function prettyJson(raw) {
  if (!raw || typeof raw !== 'string') return raw || '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// ---------------- Markdown 渲染 ----------------

function mdEscape(text) {
  if (text == null) return '';
  return String(text)
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '');
}

function renderParamTable(params, title) {
  const rows = (params || []).filter((p) => p && typeof p === 'object');
  if (!rows.length) return `**${title}**\n\n无\n`;
  let out = `**${title}**\n\n| 参数名 | 类型 | 必填 | 示例值 | 说明 |\n| --- | --- | --- | --- | --- |\n`;
  for (const p of rows) {
    const disabled = p.is_checked === 0 ? ' *(已禁用)*' : '';
    const nn = p.not_null;
    const required = nn === 1 || nn === '1' || nn === true ? '是' : '否';
    out += `| \`${mdEscape(p.key)}\`${disabled} | ${mdEscape(p.field_type)} | ${required} | ${mdEscape(p.value)} | ${mdEscape(p.description)} |\n`;
  }
  return out + '\n';
}

function renderRequest(request) {
  request = request || {};
  const parts = [];

  const headers = asParams(request.header);
  if (headers.length) parts.push(renderParamTable(headers, '请求 Header'));

  const query = asParams(request.query);
  if (query.length) parts.push(renderParamTable(query, '请求 Query'));

  const restful = asParams(request.restful).length ? asParams(request.restful) : asParams(request.resful);
  if (restful.length) parts.push(renderParamTable(restful, '路径变量 (Restful)'));

  const { mode, body } = bodyInfo(request);
  const m = String(mode || 'none').toLowerCase();
  if (m === 'none' || m === '') {
    // no body
  } else if (m === 'json' || m === 'raw') {
    const raw = body.raw || '';
    parts.push(`**请求 Body** (\`${m}\`)\n`);
    if (raw) parts.push('```json\n' + prettyJson(raw) + '\n```\n');
    const rp = body.raw_parameter || [];
    if (rp.length) parts.push(renderParamTable(rp, 'Body 字段说明'));
  } else {
    parts.push(renderParamTable(asParams(body), `请求 Body (\`${m}\`)`));
  }

  const auth = request.auth || {};
  const atype = auth.type || 'noauth';
  if (atype && atype !== 'noauth') {
    parts.push(`**认证方式**: \`${atype}\`\n`);
  }
  return parts.join('\n');
}

function renderResponse(response) {
  response = response || {};
  const examples = asExampleList(response);
  if (!examples.length) return '';
  const parts = ['**响应示例**\n'];
  for (const ex of examples) {
    if (!ex || typeof ex !== 'object') continue;
    const name = expectField(ex, 'name') || '响应';
    const code = expectField(ex, 'code');
    const ct = expectField(ex, 'contentType', 'content_type');
    let header = `#### ${name}`;
    if (code) header += ` (${code})`;
    if (ct) header += ` · ${ct}`;
    parts.push(header + '\n');
    const raw = ex.raw || '';
    if (raw) {
      const lang = String(ct || '').toLowerCase().startsWith('json') || raw.trim().startsWith('{') ? 'json' : '';
      parts.push('```' + lang + '\n' + prettyJson(raw) + '\n```\n');
    }
    const rp = ex.raw_parameter || [];
    if (rp.length) parts.push(renderParamTable(rp, '响应字段说明'));
  }
  return parts.join('\n');
}

const TYPE_LABEL = {
  api: '接口',
  folder: '目录',
  doc: '文档',
  sse: 'SSE',
  graphql: 'GraphQL',
  websocket2: 'WebSocket',
  socketio: 'SocketIO',
  socket: 'TCP客户端',
  socket_method: 'TCP方法',
};

function renderApi(node, detail, depth) {
  const method = String(node.method || '').toUpperCase();
  const url = node.url;
  const anchor = node.target_id;
  const head = '#'.repeat(depth);
  let title = node.name;
  if (method) title += ` \`${method}\``;
  const lines = [`<a id="${anchor}"></a>`, `${head} ${title}`, ''];
  if (url) lines.push(`**URL**: \`${url}\`\n`);
  if (node.target_type && node.target_type !== 'api') {
    lines.push(`**类型**: ${TYPE_LABEL[node.target_type] || node.target_type}\n`);
  }
  const desc = (detail || {}).description || '';
  if (desc) lines.push(`**描述**: ${desc}\n`);
  const request = (detail || {}).request;
  if (request) {
    lines.push(renderRequest(request));
    lines.push('');
  }
  const response = (detail || {}).response;
  if (response) {
    lines.push(renderResponse(response));
    lines.push('');
  }
  return lines.join('\n');
}

function renderToc(tree, depth = 0) {
  const lines = [];
  for (const node of tree) {
    const indent = '  '.repeat(depth);
    const anchor = node.target_id;
    const label = node.name;
    if (node.target_type === 'folder') {
      lines.push(`${indent}- [${label}](#${anchor})`);
      lines.push(...renderToc(node.children, depth + 1));
    } else {
      const method = String(node.method || '').toUpperCase();
      const tag = method ? `\`${method}\` ` : '';
      lines.push(`${indent}- ${tag}[${label}](#${anchor})`);
    }
  }
  return lines;
}

function renderFolderHeader(node, depth) {
  const anchor = node.target_id;
  const head = '#'.repeat(depth);
  return [`<a id="${anchor}"></a>`, `${head} ${node.name}`, ''];
}

function renderTreeMd(tree, details, depth = 2) {
  const out = [];
  for (const node of tree) {
    if (node.target_type === 'folder') {
      out.push(...renderFolderHeader(node, depth));
      out.push(...renderTreeMd(node.children, details, depth + 1));
      out.push('---\n');
    } else {
      const detail = details[node.target_id] || {};
      out.push(renderApi(node, detail, depth));
      out.push('');
    }
  }
  return out;
}

function renderGlobalParamMd(globalParam) {
  const gp = ((globalParam || {}).global_param) || {};
  const hasHeader = asParams(gp.header).length > 0;
  const hasQuery = asParams(gp.query).length > 0;
  const body = gp.body;
  const { mode, body: binfo } = body ? bodyInfo({ body }) : { mode: 'none', body: {} };
  const hasBody = (mode === 'json' || mode === 'raw') ? !!(binfo.raw) : asParams(binfo).length > 0;
  const auth = gp.auth || {};
  const hasAuth = auth && typeof auth === 'object' && (auth.type || 'noauth') !== 'noauth';
  if (!hasHeader && !hasQuery && !hasBody && !hasAuth) return '';
  const parts = ['## 公共参数\n', '> 项目级公共参数，对所有接口生效。\n'];
  if (hasHeader) parts.push(renderParamTable(asParams(gp.header), '公共请求 Header'));
  if (hasQuery) parts.push(renderParamTable(asParams(gp.query), '公共请求 Query'));
  if (hasBody) {
    if (mode === 'json' || mode === 'raw') {
      parts.push(`**公共请求 Body** (\`${mode}\`)\n\`\`\`json\n${prettyJson(binfo.raw)}\n\`\`\`\n`);
    } else {
      parts.push(renderParamTable(asParams(binfo), `公共请求 Body (\`${mode}\`)`));
    }
  }
  if (hasAuth) parts.push(`**公共认证方式**: \`${auth.type}\`\n`);
  return parts.join('\n');
}

function countNodes(nodes) {
  let folders = 0;
  let apis = 0;
  for (const n of nodes) {
    if (n.target_type === 'folder') {
      folders++;
      const c = countNodes(n.children);
      folders += c.folders;
      apis += c.apis;
    } else {
      apis++;
    }
  }
  return { folders, apis };
}

function renderMarkdown(cfg, projectInfo, globalParam, tree, details) {
  const name = String(projectInfo.name || 'Apipost 项目').trim();
  const intro = String(projectInfo.intro || '').trim();
  const { folders, apis } = countNodes(tree);
  const parts = [`# ${name} 接口文档\n`];
  const meta = [
    '> 来源: Apipost Open API',
    `> 项目ID: \`${cfg.project_id}\``,
    `> 接口数: ${apis} | 目录数: ${folders}`,
    `> 导出时间: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
  ];
  if (intro) meta.push(`> 简介: ${intro}`);
  parts.push(meta.join('\n') + '\n');
  parts.push('---\n');
  const gpMd = renderGlobalParamMd(globalParam);
  if (gpMd) {
    parts.push(gpMd);
    parts.push('---\n');
  }
  parts.push('## 目录\n');
  parts.push(renderToc(tree).join('\n'));
  parts.push('\n---\n');
  parts.push(...renderTreeMd(tree, details));
  return parts.join('\n');
}

function exportJson(cfg, projectInfo, globalParam, tree, details) {
  return JSON.stringify(
    { project: projectInfo, global_param: globalParam, tree, details },
    null,
    2,
  );
}

// ---------------- OpenAPI 渲染 ----------------

// Apipost field_type → JSON Schema type
const FIELD_TYPE_MAP = {
  string: 'string', str: 'string', text: 'string', char: 'string',
  number: 'number', num: 'number', float: 'number', double: 'number',
  int: 'integer', integer: 'integer', long: 'integer',
  boolean: 'boolean', bool: 'boolean',
  array: 'array', list: 'array',
  object: 'object', json: 'object',
  file: 'string', binary: 'string',
  null: 'null', undefined: 'string',
};

function mapFieldType(t) {
  const key = String(t || '').toLowerCase().trim();
  return FIELD_TYPE_MAP[key] || 'string';
}

// 规范化 Apipost schema 为标准 JSON Schema:
// 剔除 Apipost 私有的 APIPOST_ORDERS,并按其重排 properties 顺序(保留给前端类型生成的可读顺序)
function normalizeSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  if (depth > 30) return {}; // 防御性递归深度
  const out = {};
  for (const k of Object.keys(schema)) {
    if (k === 'APIPOST_ORDERS') continue;
    let v = schema[k];
    if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      const orders = Array.isArray(schema.APIPOST_ORDERS) ? schema.APIPOST_ORDERS : [];
      const ordered = orders.filter((o) => v[o] != null);
      const rest = keys.filter((o) => !ordered.includes(o));
      const merged = {};
      for (const o of ordered) merged[o] = normalizeSchema(v[o], depth + 1);
      for (const o of rest) merged[o] = normalizeSchema(v[o], depth + 1);
      v = merged;
    } else if (k === 'items' && v && typeof v === 'object' && !Array.isArray(v)) {
      v = normalizeSchema(v, depth + 1);
    }
    out[k] = v;
  }
  return out;
}

// 无 raw_schema 时,从 raw JSON 字符串反推 schema(兜底)
function inferSchemaFromRaw(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    return inferSchemaFromValue(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function inferSchemaFromValue(v) {
  if (v == null) return { type: 'string' };
  if (Array.isArray(v)) {
    return { type: 'array', items: v.length ? inferSchemaFromValue(v[0]) : {} };
  }
  if (typeof v === 'object') {
    const properties = {};
    for (const k of Object.keys(v)) properties[k] = inferSchemaFromValue(v[k]);
    return { type: 'object', properties };
  }
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer' } : { type: 'number' };
  if (typeof v === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}

function paramRequired(p, location) {
  if (location === 'path') return true; // OpenAPI 规定 path 参数必填
  const nn = p.not_null;
  return nn === 1 || nn === '1' || nn === true;
}

// 单个 parameter 项 → OpenAPI parameter 对象
function paramToParameter(p, location) {
  const name = String((p && p.key) || '');
  if (!name) return null;
  const schema = (p.schema && typeof p.schema === 'object' && !Array.isArray(p.schema))
    ? normalizeSchema(p.schema)
    : { type: mapFieldType(p.field_type) };
  return {
    name,
    in: location,
    required: paramRequired(p, location),
    description: String((p && p.description) || ''),
    schema,
  };
}

function paramsToParameters(params, location) {
  return (params || [])
    .filter((p) => p && typeof p === 'object')
    .map((p) => paramToParameter(p, location))
    .filter(Boolean);
}

// parameter[] → object schema,支持点路径 key(如 "data.access_token")展开为嵌套 object
// 适用于 form-data/urlencoded 的 body.parameter、json 的 raw_parameter、response 的 raw_parameter
function leafSchemaOf(p) {
  if (p.schema && typeof p.schema === 'object' && !Array.isArray(p.schema)) {
    const s = normalizeSchema(p.schema);
    if (p.description && !s.description) s.description = String(p.description);
    return s;
  }
  if (String(p.field_type || '').toLowerCase() === 'file') {
    return { type: 'string', format: 'binary', ...(p.description ? { description: String(p.description) } : {}) };
  }
  return { type: mapFieldType(p.field_type), ...(p.description ? { description: String(p.description) } : {}) };
}

function paramsToSchema(params) {
  const root = { type: 'object', properties: {}, required: [] };
  for (const p of (params || [])) {
    if (!p || !p.key) continue;
    const segments = String(p.key).split('.');
    let parent = root;
    // 建/找中间 object 节点
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      let node = parent.properties[seg];
      if (!node) {
        node = { type: 'object', properties: {}, required: [] };
        parent.properties[seg] = node;
      } else if (!node.properties) {
        node.type = 'object';
        node.properties = {};
        node.required = [];
      }
      parent = node;
    }
    const leafKey = segments[segments.length - 1];
    parent.properties[leafKey] = leafSchemaOf(p);
    if (paramRequired(p, 'body') && !parent.required.includes(leafKey)) {
      parent.required.push(leafKey);
    }
  }
  // 清理空 required
  const clean = (node) => {
    if (node.properties) {
      for (const k of Object.keys(node.properties)) clean(node.properties[k]);
      if (node.required && node.required.length === 0) delete node.required;
    }
  };
  clean(root);
  return root;
}

// schema 是否含实质 properties(非空占位)。Apipost 的 raw_schema 常为 {"type":"object"} 空壳,
// 真正字段在 raw_parameter;此函数用于判断该回退到 raw_parameter
function schemaHasProperties(schema) {
  return !!schema && typeof schema === 'object' && !Array.isArray(schema)
    && schema.properties && Object.keys(schema.properties).length > 0;
}

function bodyToRequestBody(mode, body) {
  const m = String(mode || 'none').toLowerCase();
  if (!m || m === 'none') return undefined;
  const content = {};
  if (m === 'json' || m === 'raw') {
    let parsed;
    let isJson = false;
    if (body.raw && typeof body.raw === 'string' && body.raw.trim()) {
      try { parsed = JSON.parse(body.raw); isJson = true; } catch { /* 非 JSON,按文本处理 */ }
    }
    const ct = (m === 'json' || isJson) ? 'application/json' : 'text/plain';
    const entry = {};
    // schema 优先级: raw_schema(有实质 properties) > raw_parameter(点路径展开) > 从 raw 反推
    if (schemaHasProperties(body.raw_schema)) {
      entry.schema = normalizeSchema(body.raw_schema);
    } else if (Array.isArray(body.raw_parameter) && body.raw_parameter.length) {
      entry.schema = paramsToSchema(body.raw_parameter);
    } else if (isJson) {
      entry.schema = inferSchemaFromValue(parsed);
    }
    if (body.raw) entry.example = isJson ? parsed : body.raw;
    content[ct] = entry;
  } else if (m === 'form-data') {
    content['multipart/form-data'] = { schema: paramsToSchema(asParams(body.parameter)) };
  } else if (m === 'urlencoded') {
    content['application/x-www-form-urlencoded'] = { schema: paramsToSchema(asParams(body.parameter)) };
  } else if (m === 'binary') {
    content['application/octet-stream'] = { schema: { type: 'string', format: 'binary' } };
  }
  if (!Object.keys(content).length) return undefined;
  return { content };
}

function normalizeContentType(ct) {
  const c = String(ct || 'json').toLowerCase().trim();
  if (!c || c === 'json') return 'application/json';
  if (c.startsWith('application/json') || c === 'json') return 'application/json';
  if (c.startsWith('xml') || c.includes('xml')) return 'application/xml';
  if (c === 'html' || c.includes('html')) return 'text/html';
  if (c === 'text' || c === 'plain') return 'text/plain';
  if (c.startsWith('application/') || c.startsWith('text/')) return c.split(';')[0].trim();
  return 'application/json';
}

function responseToOpenApi(response) {
  const out = {};
  const examples = asExampleList(response);
  if (!examples.length) return { '200': { description: '成功' } };
  for (const ex of examples) {
    if (!ex || typeof ex !== 'object') continue;
    const expect = (ex.expect && typeof ex.expect === 'object') ? ex.expect : {};
    const code = String(expect.code || '200');
    const ct = normalizeContentType(expect.contentType || expect.content_type);
    const entry = { description: String(expect.name || '成功') };
    // schema 优先级: expect.schema(有实质 properties) > raw_parameter(点路径展开) > 无 schema
    const exSchema = (expect.schema && typeof expect.schema === 'object' && !Array.isArray(expect.schema))
      ? expect.schema
      : null;
    let schema;
    if (schemaHasProperties(exSchema)) {
      schema = normalizeSchema(exSchema);
    } else if (Array.isArray(ex.raw_parameter) && ex.raw_parameter.length) {
      schema = paramsToSchema(ex.raw_parameter);
    }
    const content = {};
    const item = {};
    if (schema) item.schema = schema;
    if (ex.raw) {
      let exVal;
      try { exVal = JSON.parse(ex.raw); } catch { exVal = ex.raw; }
      item.example = exVal;
    }
    if (Object.keys(item).length) content[ct] = item;
    if (Object.keys(content).length) entry.content = content;
    // 同一状态码多个 example:后者覆盖(OpenAPI 单 example 场景,少见且可接受)
    out[code] = entry;
  }
  return out;
}

// 把 Apipost URL 转成 OpenAPI path,必要时拆出 server
function parseApiUrl(rawUrl) {
  let url = String(rawUrl || '').trim();
  let server = null;
  const m = url.match(/^(https?:\/\/[^/]+)(.*)$/);
  if (m) {
    server = m[1];
    url = m[2] || '/';
  }
  // :param → {param} (Express 风格转 OpenAPI 风格)
  url = url.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
  if (!url.startsWith('/')) url = '/' + url;
  return { server, path: url || '/' };
}

function slugifyOp(name) {
  const s = String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return s || '';
}

function makeOperationId(name, targetId, used) {
  let slug = slugifyOp(name);
  const id8 = String(targetId || '').replace(/[^A-Za-z0-9]/g, '').slice(-8);
  if (!slug) {
    // 非英文名(如纯中文):用 target_id 末段生成稳定 operationId
    slug = 'op' + (id8 ? '_' + id8 : '');
  }
  if (used.has(slug)) {
    // 冲突:追加 target_id 末段消歧(稳定,不依赖遍历顺序)
    const suffix = id8 || 'x';
    let final = slug + '_' + suffix;
    let n = 2;
    while (used.has(final)) { final = slug + '_' + suffix + '_' + n; n++; }
    used.add(final);
    return final;
  }
  used.add(slug);
  return slug;
}

// auth.type → OpenAPI securityScheme/security(仅 bearer/basic;其余跳过)
function authToSecurity(type, auth, schemes) {
  const t = String(type || 'noauth').toLowerCase();
  if (!t || t === 'noauth' || t === 'inherit') return null;
  if (t === 'bearer') {
    if (!schemes.BearerAuth) schemes.BearerAuth = { type: 'http', scheme: 'bearer' };
    return { BearerAuth: [] };
  }
  if (t === 'basic') {
    if (!schemes.BasicAuth) schemes.BasicAuth = { type: 'http', scheme: 'basic' };
    return { BasicAuth: [] };
  }
  return null;
}

// 收集所有 api 节点(附带直接父 folder 名作为 tag)
function collectApiOps(tree, parentFolder, out) {
  for (const node of tree) {
    if (node.target_type === 'folder') {
      collectApiOps(node.children, node.name, out);
    } else if (node.target_type === 'api') {
      out.push({ node, tag: parentFolder });
    }
  }
}

const OPENAPI_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

function renderOpenAPI(cfg, projectInfo, globalParam, tree, details) {
  const gp = ((globalParam || {}).global_param) || {};
  const globalHeaders = asParams(gp.header);
  const globalQuery = asParams(gp.query);
  const globalAuth = gp.auth || {};
  const globalAuthType = globalAuth.type || 'noauth';

  const ops = [];
  collectApiOps(tree, null, ops);

  const paths = {};
  const servers = new Map();
  const opIdUsed = new Set();
  const securitySchemes = {};
  const globalSecurity = [];
  let dupWarnings = 0;

  for (const { node, tag } of ops) {
    const detail = details[node.target_id] || {};
    const request = (detail.request && typeof detail.request === 'object') ? detail.request : {};
    const urlInfo = parseApiUrl(node.url);
    if (urlInfo.server) servers.set(urlInfo.server, true);
    const pathKey = urlInfo.path;
    const methodRaw = String(node.method || 'GET').toLowerCase();
    const method = OPENAPI_METHODS.includes(methodRaw) ? methodRaw : 'get';

    const parameters = [];
    const restful = asParams(request.restful).length ? asParams(request.restful) : asParams(request.resful);
    for (const p of paramsToParameters(restful, 'path')) parameters.push(p);
    for (const p of paramsToParameters(asParams(request.query), 'query')) parameters.push(p);
    for (const p of paramsToParameters(asParams(request.header), 'header')) parameters.push(p);
    // 并入全局 query/header(同名跳过,接口自身优先)
    const seen = new Set(parameters.map((p) => p.in + ':' + p.name));
    for (const p of paramsToParameters(globalQuery, 'query')) {
      const k = 'query:' + p.name;
      if (!seen.has(k)) { parameters.push(p); seen.add(k); }
    }
    for (const p of paramsToParameters(globalHeaders, 'header')) {
      const k = 'header:' + p.name;
      if (!seen.has(k)) { parameters.push(p); seen.add(k); }
    }

    const operation = {
      operationId: makeOperationId(node.name, node.target_id, opIdUsed),
      summary: node.name || '',
    };
    if (detail.description) operation.description = String(detail.description);
    if (tag) operation.tags = [tag];
    if (parameters.length) operation.parameters = parameters;

    const { mode, body } = bodyInfo(request);
    const reqBody = bodyToRequestBody(mode, body);
    if (reqBody) operation.requestBody = reqBody;

    operation.responses = responseToOpenApi(detail.response);

    // 认证:接口级覆盖全局
    const reqAuth = request.auth || {};
    const reqAuthType = reqAuth.type || globalAuthType;
    const sec = authToSecurity(reqAuthType, reqAuth, securitySchemes);
    if (sec) {
      operation.security = [sec];
    } else if (reqAuthType === 'noauth' && globalAuthType !== 'noauth') {
      // 显式 noauth 且存在全局认证:用空数组显式排除(否则会继承根级 security)
      operation.security = [];
    }
    // inherit 或无全局认证:不设 operation.security,落到根级
    if (globalAuthType !== 'noauth') {
      const gsec = authToSecurity(globalAuthType, globalAuth, securitySchemes);
      if (gsec && !globalSecurity.find((s) => JSON.stringify(s) === JSON.stringify(gsec))) {
        globalSecurity.push(gsec);
      }
    }

    if (!paths[pathKey]) paths[pathKey] = {};
    if (paths[pathKey][method]) {
      dupWarnings++;
      console.error(`警告: ${method.toUpperCase()} ${pathKey} 重复(target_id=${node.target_id}),后者覆盖`);
    }
    paths[pathKey][method] = operation;
  }

  const spec = {
    openapi: '3.0.3',
    info: {
      title: String((projectInfo && projectInfo.name) || 'Apipost 项目'),
      version: '1.0.0',
    },
    paths,
  };
  if (projectInfo && projectInfo.intro) spec.info.description = String(projectInfo.intro);
  if (servers.size) spec.servers = Array.from(servers.keys()).map((url) => ({ url }));
  if (Object.keys(securitySchemes).length) {
    spec.components = { securitySchemes };
    if (globalSecurity.length) spec.security = globalSecurity;
  }
  spec['x-apipost-project-id'] = cfg.project_id;
  if (dupWarnings) console.error(`(共 ${dupWarnings} 个 path+method 冲突已合并)`);
  return spec;
}

// ---------------- main ----------------

function parseArgs(argv) {
  const out = { out: null, noDetails: false, asJson: false, format: 'md' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a.startsWith('--out=')) out.out = a.slice(6);
    else if (a === '--no-details') out.noDetails = true;
    else if (a === '--json') out.asJson = true;
    else if (a === '--format') out.format = String(argv[++i] || '').toLowerCase();
    else if (a.startsWith('--format=')) out.format = a.slice(9).toLowerCase();
    else if (a === '-h' || a === '--help') {
      console.log(`用法: node docs-export.js [--out FILE] [--no-details] [--json] [--format openapi]`);
      console.log(`  (默认) Markdown 接口文档`);
      console.log(`  --format openapi   OpenAPI 3.0 JSON(供前端类型/SDK 生成)`);
      console.log(`  --json            Apipost 原始 JSON 结构`);
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();

  const wantOpenApi = args.format === 'openapi';

  const projectInfo = await fetchProjectInfo(cfg);
  const items = await fetchList(cfg);
  const tree = buildTree(items);

  // OpenAPI 需要 request/response 详情,强制拉取(忽略 --no-details)
  let details = {};
  if (!args.noDetails || wantOpenApi) {
    const apiIds = items
      .filter((i) => i.target_type && i.target_type !== 'folder')
      .map((i) => i.target_id)
      .filter(Boolean);
    if (apiIds.length) details = await fetchDetails(cfg, apiIds);
  }
  const globalParam = await fetchGlobalParam(cfg);

  if (wantOpenApi) {
    const spec = renderOpenAPI(cfg, projectInfo, globalParam, tree, details);
    const out = args.out || 'openapi.json';
    fs.writeFileSync(out, JSON.stringify(spec, null, 2), 'utf-8');
    const nPaths = Object.keys(spec.paths || {}).length;
    let nOps = 0;
    for (const item of Object.values(spec.paths || {})) {
      for (const m of OPENAPI_METHODS) if (item[m]) nOps++;
    }
    const nSkipped = items.filter(
      (i) => i.target_type && i.target_type !== 'folder' && i.target_type !== 'api',
    ).length;
    console.log(`✓ OpenAPI 已生成: ${out}`);
    console.log(`  项目: ${projectInfo.name || '?'}`);
    console.log(`  路径 ${nPaths} 个, 操作 ${nOps} 个`);
    if (nSkipped) {
      console.log(`  已跳过 ${nSkipped} 个非 REST 类型(sse/graphql/websocket/socket/doc 等,OpenAPI 不支持)`);
    }
    return;
  }

  if (args.asJson) {
    const out = args.out || 'apipost.json';
    fs.writeFileSync(out, exportJson(cfg, projectInfo, globalParam, tree, details), 'utf-8');
    console.log(`已导出 JSON → ${out}`);
    return;
  }

  const out = args.out || DEFAULT_OUT;
  const md = renderMarkdown(cfg, projectInfo, globalParam, tree, details);
  fs.writeFileSync(out, md, 'utf-8');

  const nApi = items.filter((i) => i.target_type !== 'folder').length;
  const nFolder = items.filter((i) => i.target_type === 'folder').length;
  console.log(`✓ 文档已生成: ${out}`);
  console.log(`  项目: ${projectInfo.name || '?'}`);
  console.log(`  目录 ${nFolder} 个, 接口 ${nApi} 个, 已拉取详情 ${Object.keys(details).length} 个`);
  if (args.noDetails) console.log('  (使用 --no-details 模式，未拉取接口详情)');
}

// 仅作为 CLI 直接运行时执行；require() 时不自动运行（便于测试渲染逻辑）
if (require.main === module) {
  main().catch((e) => die(String(e && e.message || e)));
}

module.exports = {
  buildTree,
  asParams,
  asExampleList,
  bodyInfo,
  expectField,
  prettyJson,
  renderRequest,
  renderResponse,
  renderApi,
  renderToc,
  renderGlobalParamMd,
  renderMarkdown,
  countNodes,
  // OpenAPI
  normalizeSchema,
  mapFieldType,
  paramToParameter,
  paramsToParameters,
  paramsToSchema,
  bodyToRequestBody,
  responseToOpenApi,
  parseApiUrl,
  renderOpenAPI,
};
