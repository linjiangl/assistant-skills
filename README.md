# assistant-skills

常用 skills 汇总。每个 skill 是 `skills/<skill-name>/` 下自包含的包,`description` 命中请求时按需加载。

## Skills

| Skill | 说明 | 推荐安装范围 |
| --- | --- | --- |
| [`apipost-open-api`](skills/apipost-open-api/) | 通过 Apipost Open API 管理项目接口,导出 Markdown 接口文档。 | 项目级 |

> apipost-open-api 的 `config.json` 绑定具体项目(`project_id`),建议装到项目级目录。

## 安装

把 skill 拷贝到所用工具的项目 skills 目录即可,如 `.claude/skills`、`.codex/skills`、`.opencode/skills`:

```bash
cp -r skills/apipost-open-api .claude/skills
```

新增 skill 往 `skills/` 下加目录,并在上方表格登记一行。详细约定见 [`CLAUDE.md`](CLAUDE.md)。
