#!/usr/bin/env python3
"""Offline BOSS configuration checks and evidence-based matching; no live adapter."""
import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

OPS = {"equals", "in", "contains_any", "gte", "lte"}


def load_profile(filename):
    filename=Path(filename)
    profile=json.loads(filename.read_text(encoding='utf-8'))
    if 'screeningProfile' in profile:
        if profile.get('schemaVersion')!=1 or set(profile)!={'schemaVersion','screeningProfile','jobBindings'}:
            raise ValueError('岗位绑定文件只能含 schemaVersion、screeningProfile、jobBindings')
        name=profile['screeningProfile']
        if not isinstance(name,str) or Path(name).name!=name or name in ('.','..'):
            raise ValueError('screeningProfile 必须是同目录文件名')
        base=json.loads((filename.parent/name).read_text(encoding='utf-8'))
        if 'screeningProfile' in base:
            raise ValueError('不允许循环或多层画像引用')
        profile={**base,'jobBindings':profile['jobBindings']}
    return profile


def keyword_hits(text, keywords):
    hits=[]
    for term in keywords:
        pattern=re.escape(term)
        if term.isascii():
            pattern=r'(?<![A-Za-z0-9_])'+pattern+r'(?![A-Za-z0-9_])'
        if re.search(pattern,text,re.IGNORECASE):
            hits.append(term)
    return hits


def canonical_hash(value):
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode()).hexdigest()


def validate(profile):
    if not isinstance(profile, dict) or profile.get("schemaVersion") != 1:
        raise ValueError("profile.schemaVersion 必须为 1")
    for field in ("profileId", "revision"):
        if not isinstance(profile.get(field), str) or not profile[field].strip():
            raise ValueError(f"{field} 必须为非空文本")
    if profile.get("missingEvidence") != "needs_review":
        raise ValueError("missingEvidence 必须为 needs_review")
    for group in ("must", "reject"):
        rules = profile.get(group)
        if not isinstance(rules, list) or (group == "must" and not rules):
            raise ValueError(f"{group} 必须为列表，must 不能为空")
        for rule in rules:
            if not isinstance(rule, dict) or set(rule) != {"field", "operator", "value"}:
                raise ValueError("条件只能包含 field、operator、value")
            if not isinstance(rule["field"], str) or not rule["field"].strip():
                raise ValueError("条件 field 必须为非空文本")
            op, val = rule["operator"], rule["value"]
            if op not in OPS:
                raise ValueError(f"未知 operator: {op}")
            if op in {"in", "contains_any"} and (not isinstance(val, list) or not val):
                raise ValueError(f"{op} 必须提供非空列表")
            if op == "contains_any" and any(not isinstance(v, str) or not v.strip() for v in val):
                raise ValueError("contains_any 必须为非空文本列表")
            if op in {"gte", "lte"} and (type(val) not in (int, float)):
                raise ValueError("数值条件必须为数字")
    if not isinstance(profile.get("jobBindings"), list):
        raise ValueError("jobBindings 必须为列表")
    return canonical_hash({k: profile[k] for k in ("profileId", "revision", "must", "reject", "missingEvidence")})


def condition(rule, facts):
    fact = facts.get(rule["field"])
    if not isinstance(fact, dict) or fact.get("contradictory") is True:
        return None
    for name in ("source", "evidence", "observedAt"):
        if not isinstance(fact.get(name), str) or not fact[name].strip():
            return None
    try:
        observed = dt.datetime.fromisoformat(fact["observedAt"].replace("Z", "+00:00"))
        if observed.tzinfo is None:
            return None
    except ValueError:
        return None
    value, expected, op = fact.get("value"), rule["value"], rule["operator"]
    if value is None:
        return None
    if op == "equals":
        return value == expected if type(value) is type(expected) else None
    if op == "in":
        compatible = [x for x in expected if type(x) is type(value)]
        return value in compatible if compatible else None
    if op == "contains_any":
        return bool(keyword_hits(value,expected)) if isinstance(value, str) else None
    if type(value) not in (int, float):
        return None
    return value >= expected if op == "gte" else value <= expected


def evaluate(profile, candidates):
    rule_hash = validate(profile)
    if not isinstance(candidates, list):
        raise ValueError("候选输入必须为列表")
    seen, rows = set(), []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            raise ValueError("候选条目必须为对象")
        key, facts = candidate.get("candidateKey"), candidate.get("facts")
        if not isinstance(key, str) or not key.strip() or key in seen:
            raise ValueError("candidateKey 必须非空且唯一，不能靠同名去重")
        if not isinstance(facts, dict):
            raise ValueError("facts 必须为对象")
        seen.add(key)
        results = [{"group": group, "field": r["field"], "met": condition(r, facts)}
                   for group in ("must", "reject") for r in profile[group]]
        for check, rule in zip(results, profile['must'] + profile['reject']):
            if rule['operator'] == 'contains_any' and check['met'] is True:
                check['matchedKeywords'] = keyword_hits(facts[rule['field']]['value'],rule['value'])
        rejected = any((r["group"] == "must" and r["met"] is False)
                       or (r["group"] == "reject" and r["met"] is True) for r in results)
        unknown = any(r["met"] is None for r in results)
        decision = "rejected" if rejected else "needs_review" if unknown else "eligible"
        rows.append({"candidateKey": key, "decision": decision, "checks": results})
    return {"mode": "offline_plan", "liveActions": 0, "profileId": profile["profileId"],
            "revision": profile["revision"], "ruleHash": rule_hash,
            "counts": {name: sum(r["decision"] == name for r in rows)
                       for name in ("eligible", "rejected", "needs_review")}, "results": rows,
            "limitation": "只验证提供的事实与条件；不验证事实提取正确性、平台状态或在线发送能力"}


def main():
    parser = argparse.ArgumentParser(description="BOSS 模板离线 CLI（没有登录、抓取或发送功能）")
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("validate", "evaluate"):
        child = sub.add_parser(command)
        child.add_argument("--profile", required=True, type=Path)
        if command == "evaluate":
            child.add_argument("--candidates", required=True, type=Path)
    args = parser.parse_args()
    try:
        profile = load_profile(args.profile)
        if args.command == "validate":
            output = {"valid": True, "mode": "offline_plan", "ruleHash": validate(profile), "liveActions": 0}
        else:
            candidates=json.load(sys.stdin) if str(args.candidates)=='-' else json.loads(args.candidates.read_text())
            output = evaluate(profile, candidates)
        print(json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (ValueError, OSError, TypeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
