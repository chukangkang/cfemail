"""加载 config.yaml 中的敏感配置。"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

DEFAULT_CONFIG_PATH = Path(__file__).with_name("config.yaml")


class Config:
    def __init__(self, data: dict[str, Any]):
        cf = data.get("cloudflare", {}) or {}
        api = data.get("api", {}) or {}

        self.cf_api_token: str = (cf.get("api_token") or "").strip()
        self.cf_email: str = (cf.get("email") or "").strip()
        self.cf_api_key: str = (cf.get("api_key") or "").strip()
        self.cf_account_id: str = (cf.get("account_id") or "").strip()

        self.api_host: str = api.get("host", "0.0.0.0")
        self.api_port: int = int(api.get("port", 8000))
        self.api_access_key: str = (api.get("access_key") or "").strip()

        # 鉴权:api_token 或 (email + api_key) 二选一
        has_token = bool(self.cf_api_token)
        has_key_pair = bool(self.cf_email and self.cf_api_key)
        if not (has_token or has_key_pair):
            raise ValueError(
                "config.yaml 中 cloudflare 鉴权未配置:请填写 api_token,"
                "或同时填写 email 与 api_key"
            )

        missing = [
            k
            for k, v in {
                "cloudflare.account_id": self.cf_account_id,
                "api.access_key": self.api_access_key,
            }.items()
            if not v
        ]
        if missing:
            raise ValueError(f"config.yaml 缺少必填项: {', '.join(missing)}")


def load_config(path: str | Path | None = None) -> Config:
    p = Path(path) if path else DEFAULT_CONFIG_PATH
    if not p.exists():
        raise FileNotFoundError(
            f"未找到配置文件 {p},请复制 config.example.yaml 为 config.yaml 后填写。"
        )
    with p.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return Config(data)
