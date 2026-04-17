# Cloudflare Email Routing API

通过 HTTP 接口配置 Cloudflare 电子邮箱路由:创建自定义地址、动作为"发送到电子邮箱"、并指定目标邮箱。

## 文件结构

- `cf_email_routing.py` — 封装 Cloudflare API 的 SDK 类
- `config.py` — 读取 `config.yaml` 中的敏感信息
- `api_server.py` — 基于 FastAPI 的 HTTP 服务
- `config.example.yaml` — 配置示例,复制为 `config.yaml` 后填写

## 快速开始

```powershell
pip install -r requirements.txt
copy config.example.yaml config.yaml
# 编辑 config.yaml 填写 api_token / account_id / access_key
python api_server.py
```

服务启动后打开 `http://127.0.0.1:8000/docs` 查看 Swagger 文档并在线调试。

## 鉴权

所有 `/api/**` 请求必须在请求头添加:

```
X-API-Key: <config.yaml 中的 api.access_key>
```

## 创建转发规则示例

```powershell
curl -X POST http://127.0.0.1:8000/api/routing/rules `
  -H "X-API-Key: your_access_key" `
  -H "Content-Type: application/json" `
  -d '{
    "domain": "example.com",
    "custom_address": "hello@example.com",
    "destination": "your_mailbox@gmail.com"
  }'
```

## 注意事项

1. 域名需先在 Cloudflare 启用 Email Routing(添加 MX/SPF 记录)。
2. 目标邮箱必须先通过 Cloudflare 的验证邮件,规则才能生效。
3. API Token 至少需要权限:
   - `Zone → Email Routing Rules → Edit`
   - `Account → Email Routing Addresses → Edit`(如果要新增目标邮箱)
4. 请妥善保管 `config.yaml`,不要提交到版本库。
