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

// ---------------- main ----------------

function parseArgs(argv) {
  const out = { out: DEFAULT_OUT, noDetails: false, asJson: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a.startsWith('--out=')) out.out = a.slice(6);
    else if (a === '--no-details') out.noDetails = true;
    else if (a === '--json') out.asJson = true;
    else if (a === '-h' || a === '--help') {
      console.log(`用法: node docs-export.js [--out FILE] [--no-details] [--json]`);
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();

  const projectInfo = await fetchProjectInfo(cfg);
  const items = await fetchList(cfg);
  const tree = buildTree(items);

  let details = {};
  if (!args.noDetails) {
    const apiIds = items
      .filter((i) => i.target_type && i.target_type !== 'folder')
      .map((i) => i.target_id)
      .filter(Boolean);
    if (apiIds.length) details = await fetchDetails(cfg, apiIds);
  }
  const globalParam = await fetchGlobalParam(cfg);

  if (args.asJson) {
    fs.writeFileSync(args.out, exportJson(cfg, projectInfo, globalParam, tree, details), 'utf-8');
    console.log(`已导出 JSON → ${args.out}`);
    return;
  }

  const md = renderMarkdown(cfg, projectInfo, globalParam, tree, details);
  fs.writeFileSync(args.out, md, 'utf-8');

  const nApi = items.filter((i) => i.target_type !== 'folder').length;
  const nFolder = items.filter((i) => i.target_type === 'folder').length;
  console.log(`✓ 文档已生成: ${args.out}`);
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
};
