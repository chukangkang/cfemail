"""
通过 Cloudflare API 配置 Email Routing(电子邮箱路由)
功能:创建一条自定义地址规则,动作为"发送到电子邮箱",并指定目标地址。

依赖:
    pip install requests

前置条件:
1. 你的域名已在 Cloudflare 托管,并已启用 Email Routing。
2. 目标邮箱(destination)已在 Email Routing 中验证通过。
3. 准备好 API Token(推荐),需要具备以下权限:
   - Zone -> Email Routing Rules -> Edit
   - Account -> Email Routing Addresses -> Edit (若要通过 API 新增目标地址)

API 文档:
- 规则: https://developers.cloudflare.com/api/operations/email-routing-routing-rules-create-a-routing-rule
- 目标地址: https://developers.cloudflare.com/api/operations/email-routing-destination-addresses-create-a-destination-address
"""

from __future__ import annotations

from typing import Any

import requests

CF_API = "https://api.cloudflare.com/client/v4"


class CloudflareEmailRouting:
    def __init__(
        self,
        api_token: str | None = None,
        email: str | None = None,
        api_key: str | None = None,
    ):
        """
        鉴权二选一:
        - 传入 api_token,使用 Bearer Token 方式(推荐)
        - 传入 email + api_key(Global API Key),使用 X-Auth-Email / X-Auth-Key
        """
        self.session = requests.Session()
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_token:
            headers["Authorization"] = f"Bearer {api_token}"
        elif email and api_key:
            headers["X-Auth-Email"] = email
            headers["X-Auth-Key"] = api_key
        else:
            raise ValueError("必须提供 api_token,或同时提供 email 与 api_key")
        self.session.headers.update(headers)

    # ---------- 基础请求 ----------
    def _request(self, method: str, path: str, **kwargs) -> dict[str, Any]:
        resp = self.session.request(method, f"{CF_API}{path}", timeout=30, **kwargs)
        data = resp.json()
        if not data.get("success"):
            raise RuntimeError(f"Cloudflare API 错误: {data.get('errors')}")
        return data

    # ---------- 查询 Zone ID ----------
    def get_zone_id(self, domain: str) -> str:
        data = self._request("GET", "/zones", params={"name": domain})
        result = data["result"]
        if not result:
            raise ValueError(f"未找到域名 {domain} 对应的 Zone")
        return result[0]["id"]

    # ---------- 目标地址(destination) ----------
    def add_destination_address(self, account_id: str, email: str) -> dict[str, Any]:
        """新增目标邮箱。Cloudflare 会向该邮箱发送验证邮件,需手动点击完成验证。"""
        return self._request(
            "POST",
            f"/accounts/{account_id}/email/routing/addresses",
            json={"email": email},
        )["result"]

    def list_destination_addresses(self, account_id: str) -> list[dict[str, Any]]:
        return self._request(
            "GET", f"/accounts/{account_id}/email/routing/addresses"
        )["result"]

    # ---------- 路由规则(rules) ----------
    def create_forward_rule(
        self,
        zone_id: str,
        custom_address: str,
        destination: str,
        name: str | None = None,
        enabled: bool = True,
        priority: int = 0,
    ) -> dict[str, Any]:
        """
        创建一条"自定义地址 -> 转发到电子邮箱"的规则。

        :param zone_id: 域名对应的 zone id
        :param custom_address: 自定义地址,例如 hello@example.com
        :param destination: 目标邮箱(必须已在 Cloudflare 验证通过)
        :param name: 规则名称
        :param enabled: 是否启用
        :param priority: 优先级(数字越小越靠前)
        """
        payload = {
            "name": name or f"Forward {custom_address} -> {destination}",
            "enabled": enabled,
            "priority": priority,
            "matchers": [
                {
                    "type": "literal",
                    "field": "to",
                    "value": custom_address,
                }
            ],
            "actions": [
                {
                    "type": "forward",  # 发送到电子邮箱
                    "value": [destination],
                }
            ],
        }
        return self._request(
            "POST",
            f"/zones/{zone_id}/email/routing/rules",
            json=payload,
        )["result"]

    def list_rules(self, zone_id: str) -> list[dict[str, Any]]:
        return self._request("GET", f"/zones/{zone_id}/email/routing/rules")["result"]

    def delete_rule(self, zone_id: str, rule_id: str) -> dict[str, Any]:
        return self._request(
            "DELETE", f"/zones/{zone_id}/email/routing/rules/{rule_id}"
        )["result"]

    def delete_all_custom_rules(self, zone_id: str) -> dict[str, Any]:
        """
        删除该域名下所有"自定义地址(literal)"规则。
        会跳过 catch-all 规则,避免误伤兜底转发。
        返回删除结果汇总。
        """
        deleted: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        failed: list[dict[str, Any]] = []
        for rule in self.list_rules(zone_id):
            matchers = rule.get("matchers") or []
            # 只处理自定义地址(literal 匹配 to),保留 catch-all
            is_custom = any(
                m.get("type") == "literal" and m.get("field") == "to"
                for m in matchers
            )
            if not is_custom:
                skipped.append({"id": rule.get("tag") or rule.get("id"), "name": rule.get("name")})
                continue
            rule_id = rule.get("tag") or rule.get("id")
            try:
                self.delete_rule(zone_id, rule_id)
                deleted.append({"id": rule_id, "name": rule.get("name")})
            except Exception as e:
                failed.append({"id": rule_id, "name": rule.get("name"), "error": str(e)})
        return {
            "deleted_count": len(deleted),
            "skipped_count": len(skipped),
            "failed_count": len(failed),
            "deleted": deleted,
            "skipped": skipped,
            "failed": failed,
        }


