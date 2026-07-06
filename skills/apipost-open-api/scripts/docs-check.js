#!/usr/bin/env node
'use strict';

/**
 * 检查 Apipost 配置是否就绪（不输出任何敏感值）
 * 用法（<skill> 指本 skill 的安装目录）: node <skill>/scripts/docs-check.js
 */

const fs = require('fs');
const path = require('path');

// 配置文件位于 skill 包根目录（与本文件 ../ 同级），随项目走、不依赖用户主目录
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const REQUIRED = ['api_key', 'project_id'];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(CONFIG_PATH)) {
  fail(
    `配置文件不存在: ${CONFIG_PATH}\n` +
    `请先复制 config.example.json 为 config.json 并填入 api_key / project_id。`
  );
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
} catch (e) {
  fail(`配置 JSON 解析失败: ${CONFIG_PATH}\n${e.message}`);
}

const missing = REQUIRED.filter((k) => {
  const v = String(cfg[k] != null ? cfg[k] : '').trim();
  return !v || v === '""' || v === "''";
});

if (missing.length) {
  fail(`配置缺少必填字段: ${missing.join(', ')}\n请编辑 ${CONFIG_PATH} 补全。`);
}

console.log('配置检查通过');
