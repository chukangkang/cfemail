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

        self.cf_api_token: str = cf.get("api_token", "")
        self.cf_account_id: str = cf.get("account_id", "")

        self.api_host: str = api.get("host", "0.0.0.0")
        self.api_port: int = int(api.get("port", 8000))
        self.api_access_key: str = api.get("access_key", "")

        missing = [
            k
            for k, v in {
                "cloudflare.api_token": self.cf_api_token,
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
