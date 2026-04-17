"""
基于 FastAPI 提供 HTTP 接口,调用 Cloudflare Email Routing。

启动:
    pip install -r requirements.txt
    python api_server.py
    # 或:uvicorn api_server:app --host 0.0.0.0 --port 8000

鉴权:
    所有 /api/** 接口均需在请求头中携带 X-API-Key: <config.yaml 中的 api.access_key>

主要接口:
    POST /api/routing/rules           创建"自定义地址 -> 转发到邮箱"规则
    GET  /api/routing/rules           列出域名下的所有规则
    DELETE /api/routing/rules/{id}    删除某条规则(需带 domain 查询参数)
    GET  /api/routing/destinations    列出目标邮箱
    POST /api/routing/destinations    新增目标邮箱(需手动在邮件中点击验证)
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any, Optional

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from cf_email_routing import CloudflareEmailRouting
from config import Config, load_config


# ---------- 依赖 ----------
@lru_cache
def get_config() -> Config:
    return load_config()


@lru_cache
def get_cf() -> CloudflareEmailRouting:
    cfg = get_config()
    return CloudflareEmailRouting(
        api_token=cfg.cf_api_token or None,
        email=cfg.cf_email or None,
        api_key=cfg.cf_api_key or None,
    )


def verify_api_key(x_api_key: str = Header(default="")) -> None:
    if x_api_key != get_config().api_access_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的 X-API-Key"
        )


def verify_del_key(x_del_key: str = Header(default="")) -> None:
    """删除接口专用密钥,使用请求头 X-Del-Key。"""
    if x_del_key != get_config().api_del_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的 X-Del-Key"
        )


# ---------- 数据模型 ----------
class CreateRuleRequest(BaseModel):
    domain: str = Field(..., description="Cloudflare 上托管的域名,如 example.com")
    custom_address: EmailStr = Field(..., description="自定义地址,如 hello@example.com")
    destination: EmailStr = Field(..., description="目标邮箱,必须已在 Cloudflare 验证通过")
    name: Optional[str] = None
    enabled: bool = True
    priority: int = 0


class DestinationRequest(BaseModel):
    email: EmailStr


# ---------- App ----------
app = FastAPI(title="Cloudflare Email Routing API", version="1.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/api/routing/rules",
    dependencies=[Depends(verify_api_key)],
    summary="创建转发规则(自定义地址 -> 发送到电子邮箱)",
)
def create_rule(body: CreateRuleRequest) -> dict[str, Any]:
    cf = get_cf()
    try:
        zone_id = cf.get_zone_id(body.domain)
        rule = cf.create_forward_rule(
            zone_id=zone_id,
            custom_address=body.custom_address,
            destination=body.destination,
            name=body.name,
            enabled=body.enabled,
            priority=body.priority,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "zone_id": zone_id, "rule": rule}


@app.get(
    "/api/routing/rules",
    dependencies=[Depends(verify_api_key)],
    summary="列出域名下所有路由规则",
)
def list_rules(domain: str) -> dict[str, Any]:
    cf = get_cf()
    try:
        zone_id = cf.get_zone_id(domain)
        rules = cf.list_rules(zone_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "zone_id": zone_id, "rules": rules}


@app.delete(
    "/api/routing/rules/{rule_id}",
    dependencies=[Depends(verify_del_key)],
    summary="删除指定规则(需在请求头携带 X-Del-Key)",
)
def delete_rule(rule_id: str, domain: str) -> dict[str, Any]:
    cf = get_cf()
    try:
        zone_id = cf.get_zone_id(domain)
        result = cf.delete_rule(zone_id, rule_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "result": result}


@app.get(
    "/api/routing/destinations",
    dependencies=[Depends(verify_api_key)],
    summary="列出已登记的目标邮箱",
)
def list_destinations() -> dict[str, Any]:
    cf = get_cf()
    try:
        data = cf.list_destination_addresses(get_config().cf_account_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "destinations": data}


@app.post(
    "/api/routing/destinations",
    dependencies=[Depends(verify_api_key)],
    summary="新增目标邮箱(需手动在邮件中验证)",
)
def add_destination(body: DestinationRequest) -> dict[str, Any]:
    cf = get_cf()
    try:
        data = cf.add_destination_address(get_config().cf_account_id, body.email)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "destination": data}


if __name__ == "__main__":
    cfg = get_config()
    uvicorn.run(app, host=cfg.api_host, port=cfg.api_port)
