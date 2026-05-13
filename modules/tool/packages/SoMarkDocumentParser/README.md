# SoMark 文档解析

SoMark 文档解析工具用于将 PDF、图片、Office 文档等文件解析为结构化结果，并返回 Markdown 全文和 JSON 数据。工具适用于知识库入库、文档问答预处理、合同/报告解析、表格和公式抽取等场景。

工具同时支持 SoMark API 和 SoMark 私有化部署，两者使用同一个接口路径，仅 Base URL 和鉴权方式不同。

## 使用方式

在 FastGPT 工作流中添加 `SoMark 文档解析` 工具，选择一个文件，并按实际部署方式填写密钥配置。

### 密钥配置

| 字段 | 说明 |
| --- | --- |
| Base URL | 必填。使用 SoMark API 时填写 `https://somark.tech/api/v1`；私有化部署时填写本地部署的 Base URL（如 `https://somark.internal/api/v1`）。 |
| API Key | 使用 SoMark API 时填写，需以 `sk-` 开头；私有化部署无需填写。 |

API Key 校验在工具内自动按 Base URL 切换：

- Base URL 为 SoMark API 地址（默认地址 `https://somark.tech/api/v1`）时，API Key 必须非空且以 `sk-` 开头，否则会在调用 SoMark 之前直接报错。
- 自定义 Base URL（私有化部署）时跳过格式校验，API Key 会原样透传给后端。

### 输入参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| 文件 | 文件数组 | 无 | 必填，只支持选择 1 个文件。 |
| 输出格式 | 多选 | `json`, `markdown` | 选择返回 JSON、Markdown，或同时返回两种格式。 |
| 图片格式 | 单选 | `url` | 图片元素返回格式，支持 `url`、`base64`、`none`。 |
| 公式格式 | 单选 | `latex` | 公式元素返回格式，支持 `latex`、`mathml`、`ascii`。 |
| 表格格式 | 单选 | `html` | 表格元素返回格式，支持 `markdown`、`html`、`image`。 |
| 化学结构式格式 | 单选 | `image` | 当前仅支持 `image`。 |
| 文字跨页拼接 | 开关 | `false` | 将跨页文字段合并为连续段落。 |
| 表格跨页拼接 | 开关 | `false` | 将跨页表格合并为完整表格。 |
| 标题层级识别 | 开关 | `false` | 识别 H1、H2、H3 等标题层级。 |
| 返回文中图 | 开关 | `true` | 返回文字段落中的图片。 |
| 返回表格图 | 开关 | `true` | 返回表格单元格内的图片。 |
| 图片理解 | 开关 | `true` | 对文档内图片进行语义理解和结构化描述。 |
| 保留页眉页脚 | 开关 | `false` | 开启后保留页眉页脚内容。 |

### 输出结果

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| Markdown | 字符串 | Markdown 格式全文。未选择 Markdown 输出时为空字符串。 |
| JSON | 对象 | JSON 格式解析结果。未选择 JSON 输出时为空对象。 |

## 注意事项

- FastGPT 文件选择器传入的是文件下载 URL，工具会先下载文件，再以 multipart form-data 方式发送到 SoMark。
- 如果下载 URL 带有 `filename` 查询参数，工具会优先使用该文件名，避免临时下载地址丢失 `.pdf`、`.docx` 等后缀导致上游误判文件类型。
- 同步接口的请求超时为 10 分钟，足够覆盖大多数大文件解析场景。
- 使用 SoMark API 时必须填写 API Key，且需以 `sk-` 开头；填错会在调用 SoMark 之前直接报错。
- 私有化部署时 API Key 会原样透传，即使留空也会以空字符串形式出现在请求中，不影响后端无鉴权的场景。
