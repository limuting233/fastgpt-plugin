# SoMark 文档解析设计文档

## 目标

将 FastGPT 工作流中的单个文件交给 SoMark 文档解析工具处理，并把解析结果映射为稳定的 FastGPT 工具输出：

- `markdown`：Markdown 格式全文。
- `json`：结构化 JSON 结果。

工具同时支持 SoMark API 和 SoMark 私有化部署。两者共用同一个接口路径和响应壳，差异仅体现在 `baseUrl` 和是否要求 `api_key`，由运行时统一处理。

## 工具形态

- 工具 ID：`SoMarkDocumentParser`
- 包路径：`modules/tool/packages/SoMarkDocumentParser`
- 类型：独立工具，非工具集
- 入口文件：
  - `config.ts`：FastGPT 工具配置、密钥配置、输入输出声明
  - `src/index.ts`：Zod schema 与运行逻辑
  - `index.ts`：通过 `exportTool` 绑定 config、schema、回调

## 密钥配置

`secretInputConfig` 包含两个字段：

| key | inputType | required | 说明 |
| --- | --- | --- | --- |
| `baseUrl` | `input` | `true` | 使用 SoMark API 时填写 https://somark.tech/api/v1；私有化部署时填写本地部署的 Base URL。 |
| `apiKey` | `secret` | `false` | 使用 SoMark API 时填写，需以 `sk-` 开头；私有化部署无需填写。|

`secretInputConfig` 协议没有条件必填能力，`apiKey` 在使用 SoMark API 时事实上必填，但配置层只能保持非必填，真正的相关校验在运行时根据 `baseUrl` 自动判断。

## 运行时校验

运行时按下列顺序校验，未通过直接抛错，不发起任何网络请求：

1. `file[0]` 为空 → 抛 `File path is required`
2. `baseUrl.trim()` 为空 → 抛 `Base URL is required`
3. 去除 `baseUrl` 末尾多余的斜杠
4. 当 `baseUrl` 严格等于 `https://somark.tech/api/v1`（SoMark API）时，`apiKey.trim()` 必须以 `sk-` 开头且非空，否则抛 `API Key is invalid, please check the configuration and try again`
5. 自定义 `baseUrl`（私有化部署）跳过 API Key 校验，`apiKey` 可为空或任意字符串

设计动机：

- SoMark API 的密钥格式固定（`sk-` 前缀），把校验下沉到工具内可在用户填错时立即报错，不必等到调用 SoMark 才返回 401。
- 私有化部署的鉴权策略不在工具控制范围内（可能完全无鉴权、也可能用任意 token），所以不做格式校验，直接把 `apiKey` 透传给后端。

## 文件处理

FastGPT 的 `fileSelect` 输入以字符串数组传入文件下载 URL，本工具只接受 1 个文件：

```ts
file: z.array(z.string()).length(1, 'file is required')
```

工具使用标准 `fetch` 下载文件，并将响应体转为 `Blob` 后追加到 `FormData`：

```ts
form.append('file', blob, filename)
```

文件名按以下顺序解析：

1. 优先读取下载 URL 的 `filename` 查询参数
2. 没有 `filename` 时读取 URL path 的最后一段
3. 仍无法解析（含 URL 解析失败、空白文件名）时使用 `document`

这样处理的原因是 FastGPT 私有文件下载地址通常类似：

```text
/api/system/file/download/<token>?filename=<real-file-name>.pdf
```

如果只读取 path，传给 SoMark 的文件名会变成 token，缺少 `.pdf`、`.docx` 等后缀，部分上游服务会据此误判为不支持的文件类型。

## SoMark 请求

接口路径：`POST /parse/sync`（SoMark API 与私有化部署共用同一路径）

请求配置：

- `baseURL`：运行时校验后的 baseUrl
- `headers: {}`：显式覆盖默认 JSON Content-Type，让 multipart form-data 自动生成 boundary
- `timeout: 600_000`（10 分钟，留足大文件解析时间）
- `retries: 1`

表单字段：

| 字段 | 来源 |
| --- | --- |
| `file` | 下载后的 `Blob` 与解析出的文件名 |
| `api_key` | `apiKey.trim()` 的结果，**始终追加**，私有化部署如未填写则为空字符串 |
| `output_formats` | `outputFormats` 数组，每个值独立 append 一次 |
| `element_formats` | 图片、公式、表格、化学结构式格式配置的 JSON 字符串 |
| `feature_configs` | 跨页拼接、标题识别、图片理解、页眉页脚等开关的 JSON 字符串 |

注：`api_key` 字段始终出现在 FormData 中（值可能为空）。这样上游不需要区分有无字段，只需要按需读取即可，逻辑更简单。

## 响应映射

SoMark API 和私有化部署的响应壳一致：

```jsonc
{
  "code": 0,
  "message": "ok",
  "data": {
    "result": {
      "outputs": {
        "markdown": "...",
        "json": { /* ... */ }
      }
    }
  }
}
```

outputs 路径：`data.data.result.outputs`。

错误判断：

- `data.code !== 0` 视为业务错误，按以下优先级拼装错误详情：
  1. `data.data.error`（仅当为字符串）
  2. `data.message`
  3. `unknown error`
  并抛出 `SoMark API error: ${detail}`
- `data` 为 `null`、缺失 `code` 等异常情况也会走错误分支（`data?.code !== 0` 命中）
- outputs 缺失时抛 `SoMark response has no outputs`，避免静默把空内容当成功

输出映射规则：

- 用户勾选 `markdown` 时返回 `outputs.markdown ?? ''`，否则返回空字符串
- 用户勾选 `json` 时返回 `outputs.json ?? {}`，否则返回空对象

## 测试覆盖

测试文件：`test/index.test.ts`

测试由 5 个 describe 块组成，重点覆盖：

- **request construction**：multipart 字段构造、`POST /parse/sync` 调用参数、`timeout` / `retries`、自定义 baseUrl、baseUrl 尾部斜杠裁剪、空 apiKey 仍以空字符串形式追加到 FormData
- **validation**：文件 URL 为空、baseUrl 为空 / 空白、SoMark API 下 apiKey 为空或不以 `sk-` 开头时拒绝；私有化部署下空 apiKey 与任意 token 均放行
- **file handling**：文件名解析的 3 条主路径与 2 条 fallback（URL 解析失败、URL path 为空、`filename` 查询为空白），以及源文件下载失败
- **output mapping**：未勾选的输出格式返回空值、部分 outputs 字段返回默认值
- **error handling**：`code !== 0` 时三级 detail 选择（字符串 error / message 兜底 / unknown error）、`data` 为 `null` 的兜底分支、outputs 缺失

运行命令：

```bash
bun run test -- modules/tool/packages/SoMarkDocumentParser/test/index.test.ts
```

本仓库测试由 Vitest 驱动，不使用 `bun test`。当前覆盖率：statements / branches / functions / lines 全部 100%。

## 兼容性约束

- 运行时代码只使用标准跨运行时 API：`fetch`、`Blob`、`FormData`、`URL`
- 不依赖 Bun 专有 API，构建产物可在 Node.js v22 生产环境运行
- 不在工具函数顶层包裹兜底 `try/catch`，未知错误交给框架统一处理
