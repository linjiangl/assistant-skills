#!/usr/bin/env node
'use strict';

/**
 * Apipost 接口列表层级展示工具（从 config.json 读配置）
 *
 * 列出项目里所有接口和目录，按 parent_id 组装成树形层级打印。
 *
 * 用法（<skill> 指本 skill 的安装目录）:
 *   node <skill>/scripts/docs-list.js
 *   node <skill>/scripts/docs-list.js --json
 *   node <skill>/scripts/docs-list.js --save result.json
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// 配置文件位于 skill 包根目录（与本文件 ../ 同级），随项目走、不依赖用户主目录
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const HOST = 'https://open.apipost.net';

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
  if (missing.length) die(`配置缺少必填字段: ${missing.join(', ')}\n请在 ${CONFIG_PATH} 补全。`);
  return cfg;
}

function fetchApiList(cfg) {
  return new Promise((resolve, reject) => {
    const u = new URL(HOST + `/open/apis/list?project_id=${cfg.project_id}`);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', headers: { 'api-token': cfg.api_key } }, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        let data;
        try {
          data = JSON.parse(chunks);
        } catch (e) {
          return reject(new Error(`JSON 解析失败: ${e.message}`));
        }
        if (data.code !== 0) return reject(new Error(`错误: ${data.msg} (code=${data.code})`));
        resolve(data.data.list);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function buildTree(items) {
  const nodes = {};
  const roots = [];
  for (const item of items) {
    const tid = item.target_id;
    nodes[tid] = {
      target_id: tid,
      target_type: item.target_type || '',
      name: item.name || '',
      method: item.method || '',
      url: item.url || '',
      sort: item.sort || 0,
      parent_id: item.parent_id || '0',
      version: item.version || 0,
      children: [],
    };
  }
  for (const item of items) {
    const tid = item.target_id;
    const pid = item.parent_id || '0';
    if (pid === '0' || pid === '') roots.push(nodes[tid]);
    else if (nodes[pid]) nodes[pid].children.push(nodes[tid]);
  }
  const sortFn = (a, b) => (a.sort - b.sort) || String(a.name || '').localeCompare(String(b.name || ''));
  const sortRec = (n) => { n.children.sort(sortFn); n.children.forEach(sortRec); };
  roots.sort(sortFn);
  roots.forEach(sortRec);
  return roots;
}

function countItems(node) {
  let folders = 0;
  let apis = 0;
  if (node.target_type === 'folder') folders += 1;
  else apis += 1;
  for (const child of node.children) {
    const c = countItems(child);
    folders += c.folders;
    apis += c.apis;
  }
  return { folders, apis };
}

function printTree(nodes, prefix = '') {
  const methodColors = {
    GET: '\x1b[32m',
    POST: '\x1b[33m',
    PUT: '\x1b[34m',
    DELETE: '\x1b[31m',
    PATCH: '\x1b[35m',
  };
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  nodes.forEach((node, i) => {
    const isLast = i === nodes.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    const dimId = `${dim}[${node.target_id}]${reset}`;
    if (node.target_type === 'folder') {
      const { folders, apis } = countItems(node);
      const label = [];
      if (folders - 1 > 0) label.push(`${folders - 1} 目录`);
      if (apis > 0) label.push(`${apis} 接口`);
      const sub = label.length ? ` (${label.join(', ')})` : '';
      console.log(`${prefix}${connector}\x1b[1m${node.name}\x1b[0m ${dimId}${sub}`);
      printTree(node.children, prefix + childPrefix);
    } else {
      const method = node.method || '???';
      const color = methodColors[method.toUpperCase()] || '';
      const urlPart = node.url ? ` ${dim}${node.url}${reset}` : '';
      console.log(`${prefix}${connector}${color}${method.padEnd(7)}${reset} ${node.name} ${dimId}${urlPart}`);
    }
  });
}

function treeToDict(nodes) {
  return nodes.map((node) => {
    const item = {
      target_id: node.target_id,
      target_type: node.target_type,
      name: node.name,
      sort: node.sort,
    };
    if (node.target_type === 'folder') {
      item.children = treeToDict(node.children);
    } else {
      item.method = node.method;
      item.url = node.url;
    }
    return item;
  });
}

function main() {
  const argv = process.argv.slice(2);
  let asJson = false;
  let saveFile = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') asJson = true;
    else if (argv[i] === '--save') saveFile = argv[++i];
    else if (argv[i] === '-h' || argv[i] === '--help') {
      console.log('用法: node docs-list.js [--json] [--save FILE]');
      process.exit(0);
    }
  }

  const cfg = loadConfig();
  fetchApiList(cfg)
    .then((items) => {
      const tree = buildTree(items);
      const totalFolders = items.filter((i) => i.target_type === 'folder').length;
      const totalApis = items.filter((i) => i.target_type !== 'folder').length;

      if (asJson) {
        console.log(JSON.stringify(treeToDict(tree), null, 2));
        return;
      }
      if (saveFile) {
        fs.writeFileSync(saveFile, JSON.stringify(treeToDict(tree), null, 2), 'utf-8');
        console.log(`已保存到 ${saveFile}`);
        return;
      }
      console.log(`\n共 ${totalFolders} 个目录, ${totalApis} 个接口\n`);
      printTree(tree);
      console.log('');
    })
    .catch((e) => die(String(e && e.message || e)));
}

main();
