#!/usr/bin/env python3
"""
测试当前数据库内用户与 Agent 之间的联通情况。

检查项：
  1. 用户列表及其拥有的 Agent（ownership via agents.owner_id）
  2. 联系人关系（contacts 表中 user -> agent 的记录）
  3. 会话关系（conversations + conversation_participants 中的 user-agent 配对）
  4. Session Key 记录（agent_session_keys 中的 user-agent 绑定）
  5. Gateway 配置可用性（config.py 中的 USER_GATEWAY_MAP）

用法：
  cd backend
  python tests/test_user_agent_connectivity.py
  python tests/test_user_agent_connectivity.py --db-url postgresql://clawnet:clawnet@localhost:5433/clawnet
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import psycopg2

DEFAULT_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://clawnet:clawnet@localhost:5432/clawnet",
).replace("postgresql+asyncpg://", "postgresql://")


def _load_gateway_user_ids() -> set[str]:
    """从 gateway_users.json 加载已配置 gateway 的用户 ID 集合"""
    gw_file = os.environ.get("GATEWAY_MAP_FILE", "gateway_users.json")
    p = Path(gw_file)
    if not p.is_absolute():
        p = Path(__file__).resolve().parent.parent / p
    if not p.exists():
        return set()
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return set(data.get("users", {}).keys())
    except Exception:
        return set()


USER_GATEWAY_MAP = _load_gateway_user_ids()

SEP = "=" * 80
THIN = "-" * 80


def query(conn, sql, params=None):
    cur = conn.cursor()
    cur.execute(sql, params or ())
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def run(db_url: str) -> int:
    print(f"\n{SEP}")
    print(f"  ClawNet 用户-Agent 联通性测试")
    print(f"  DB: {db_url}")
    print(f"{SEP}\n")

    try:
        conn = psycopg2.connect(db_url)
    except Exception as e:
        print(f"[错误] 无法连接数据库: {e}")
        return 1

    issues = []  # 收集问题

    # ================================================================
    # 1. 用户列表
    # ================================================================
    print(f"[1] 用户列表")
    print(THIN)
    users = query(conn, """
        SELECT id, display_name, email, phone, status, created_at
        FROM users ORDER BY created_at
    """)
    if not users:
        print("  (空) 没有用户。")
        return 0

    for u in users:
        gw = "有" if str(u["id"]) in USER_GATEWAY_MAP else "无"
        print(f"  [{u['display_name']}]  id={u['id']}  email={u['email']}  "
              f"status={u['status']}  Gateway配置={gw}")
    print(f"  共 {len(users)} 个用户\n")

    # ================================================================
    # 2. Agent 列表 + 所属关系
    # ================================================================
    print(f"[2] Agent 列表 (ownership)")
    print(THIN)
    agents = query(conn, """
        SELECT a.id, a.display_name, a.owner_id, a.status, a.agent_type,
               a.execution_mode, a.interaction_mode,
               u.display_name AS owner_name, u.email AS owner_email
        FROM agents a
        LEFT JOIN users u ON u.id = a.owner_id
        ORDER BY a.created_at
    """)
    if not agents:
        print("  (空) 没有 Agent。")
    else:
        for a in agents:
            print(f"  [{a['display_name']}]  id={a['id']}")
            print(f"      owner={a['owner_name']} ({a['owner_email']})  "
                  f"status={a['status']}  type={a['agent_type']}")
        print(f"  共 {len(agents)} 个 Agent\n")

    # ================================================================
    # 3. 联系人关系 (contacts)
    # ================================================================
    print(f"[3] 联系人关系 (contacts, type=agent)")
    print(THIN)
    contacts = query(conn, """
        SELECT c.user_id, c.contact_id, c.contact_type, c.nickname,
               u.display_name AS user_name,
               a.display_name AS agent_name
        FROM contacts c
        LEFT JOIN users u ON u.id = c.user_id
        LEFT JOIN agents a ON a.id = c.contact_id
        WHERE c.contact_type = 'agent'
        ORDER BY c.created_at
    """)
    if not contacts:
        print("  (空) 没有 user->agent 联系人记录。")
    else:
        for c in contacts:
            print(f"  {c['user_name']} -> {c['agent_name'] or '(未找到)'}"
                  f"  (nickname={c['nickname'] or '-'})")
        print(f"  共 {len(contacts)} 条\n")

    # ================================================================
    # 4. 会话关系 (conversations with user+agent participants)
    # ================================================================
    print(f"[4] 用户-Agent 会话 (conversations)")
    print(THIN)
    convs = query(conn, """
        SELECT c.id AS conv_id, c.type AS conv_type, c.title,
               c.last_message_preview, c.last_message_at,
               hu.participant_id AS user_id,
               u.display_name AS user_name,
               ag.participant_id AS agent_id,
               a.display_name AS agent_name,
               hu.hidden_at AS user_hidden
        FROM conversations c
        JOIN conversation_participants hu
          ON hu.conversation_id = c.id AND hu.participant_type = 'human'
        JOIN conversation_participants ag
          ON ag.conversation_id = c.id AND ag.participant_type = 'agent'
        LEFT JOIN users u ON u.id = hu.participant_id
        LEFT JOIN agents a ON a.id = ag.participant_id
        ORDER BY c.created_at
    """)
    if not convs:
        print("  (空) 没有包含 user+agent 的会话。")
    else:
        for cv in convs:
            hidden = " [已隐藏]" if cv["user_hidden"] else ""
            preview = (cv["last_message_preview"] or "")[:40]
            print(f"  [{cv['user_name']}] <-> [{cv['agent_name'] or '?'}]{hidden}")
            print(f"      conv_id={cv['conv_id']}  type={cv['conv_type']}")
            if preview:
                print(f"      最近消息: {preview}...")
            if cv["last_message_at"]:
                print(f"      最后活跃: {cv['last_message_at']}")
        print(f"  共 {len(convs)} 个会话\n")

    # ================================================================
    # 5. Session Key 记录 (agent_session_keys)
    # ================================================================
    print(f"[5] Agent Session Keys")
    print(THIN)
    skeys = query(conn, """
        SELECT sk.user_id, sk.agent_id, sk.session_key,
               sk.gateway_ws_url, sk.gateway_token, sk.updated_at,
               u.display_name AS user_name,
               a.display_name AS agent_name
        FROM agent_session_keys sk
        LEFT JOIN users u ON u.id = sk.user_id
        LEFT JOIN agents a ON a.id = sk.agent_id
        ORDER BY sk.updated_at DESC
    """)
    if not skeys:
        print("  (空) 没有 session key 记录。")
    else:
        for sk in skeys:
            print(f"  {sk['user_name']} <-> {sk['agent_name'] or '?'}")
            print(f"      session_key={sk['session_key']}")
            print(f"      gateway={sk['gateway_ws_url']}  updated={sk['updated_at']}")
        print(f"  共 {len(skeys)} 条\n")

    # ================================================================
    # 6. 消息统计
    # ================================================================
    print(f"[6] 消息统计 (按 user-agent 会话)")
    print(THIN)
    msg_stats = query(conn, """
        SELECT m.conversation_id,
               m.sender_type,
               COUNT(*) AS msg_count,
               MAX(m.created_at) AS last_msg_at
        FROM messages m
        WHERE m.conversation_id IN (
            SELECT DISTINCT c.id
            FROM conversations c
            JOIN conversation_participants hu
              ON hu.conversation_id = c.id AND hu.participant_type = 'human'
            JOIN conversation_participants ag
              ON ag.conversation_id = c.id AND ag.participant_type = 'agent'
        )
        GROUP BY m.conversation_id, m.sender_type
        ORDER BY m.conversation_id, m.sender_type
    """)
    if not msg_stats:
        print("  (空) 没有消息。")
    else:
        # 按 conversation 分组展示
        conv_map = {}
        for ms in msg_stats:
            cid = str(ms["conversation_id"])
            if cid not in conv_map:
                conv_map[cid] = {}
            conv_map[cid][ms["sender_type"]] = {
                "count": ms["msg_count"],
                "last": ms["last_msg_at"],
            }

        # 获取会话参与者名称
        for cv in convs:
            cid = str(cv["conv_id"])
            if cid in conv_map:
                stats = conv_map[cid]
                human = stats.get("human", {})
                agent = stats.get("agent", {})
                print(f"  [{cv['user_name']}] <-> [{cv['agent_name'] or '?'}]")
                print(f"      用户发送: {human.get('count', 0)} 条  "
                      f"Agent回复: {agent.get('count', 0)} 条")
                total = human.get("count", 0) + agent.get("count", 0)
                last = max(filter(None, [human.get("last"), agent.get("last")]), default=None)
                print(f"      总计: {total} 条  最后活跃: {last}")
        print()

    # ================================================================
    # 7. 完整性检查
    # ================================================================
    print(f"[7] 完整性检查")
    print(THIN)

    # 7a. 每个 user 的 agent 是否都有 contact 记录
    for u in users:
        uid = str(u["id"])
        owned_agents = [a for a in agents if str(a["owner_id"]) == uid]
        for ag in owned_agents:
            aid = str(ag["id"])
            has_contact = any(
                str(c["user_id"]) == uid and str(c["contact_id"]) == aid
                for c in contacts
            )
            if not has_contact:
                msg = f"  [缺失] 用户 {u['display_name']} 的 Agent {ag['display_name']} 未在联系人中"
                print(msg)
                issues.append(msg)

    # 7b. 每个 user-agent 对是否都有会话
    for u in users:
        uid = str(u["id"])
        owned_agents = [a for a in agents if str(a["owner_id"]) == uid]
        for ag in owned_agents:
            aid = str(ag["id"])
            has_conv = any(
                str(cv["user_id"]) == uid and str(cv["agent_id"]) == aid
                for cv in convs
            )
            if not has_conv:
                msg = f"  [缺失] 用户 {u['display_name']} 与 Agent {ag['display_name']} 没有会话"
                print(msg)
                issues.append(msg)

    # 7c. 每个 user-agent 对是否有 session key
    for u in users:
        uid = str(u["id"])
        owned_agents = [a for a in agents if str(a["owner_id"]) == uid]
        for ag in owned_agents:
            aid = str(ag["id"])
            has_sk = any(
                str(sk["user_id"]) == uid and str(sk["agent_id"]) == aid
                for sk in skeys
            )
            if not has_sk:
                msg = f"  [缺失] 用户 {u['display_name']} 与 Agent {ag['display_name']} 没有 session key"
                print(msg)
                issues.append(msg)

    # 7d. Gateway 配置检查
    for u in users:
        uid = str(u["id"])
        has_gw = uid in USER_GATEWAY_MAP
        owned_agents = [a for a in agents if str(a["owner_id"]) == uid]
        if owned_agents and not has_gw:
            msg = f"  [警告] 用户 {u['display_name']} 有 {len(owned_agents)} 个 Agent 但没有 Gateway 配置"
            print(msg)
            issues.append(msg)

    # 7e. 孤儿 Agent（owner 不存在）
    user_ids = {str(u["id"]) for u in users}
    for ag in agents:
        if str(ag["owner_id"]) not in user_ids:
            msg = f"  [错误] Agent {ag['display_name']} 的 owner_id={ag['owner_id']} 不存在"
            print(msg)
            issues.append(msg)

    if not issues:
        print("  所有检查通过！用户-Agent 关系完整。")

    # ================================================================
    # 汇总
    # ================================================================
    print(f"\n{SEP}")
    print(f"  汇总")
    print(f"{SEP}")
    print(f"  用户数:        {len(users)}")
    print(f"  Agent数:       {len(agents)}")
    print(f"  联系人(agent): {len(contacts)}")
    print(f"  会话(u+a):     {len(convs)}")
    print(f"  Session Keys:  {len(skeys)}")
    print(f"  问题数:        {len(issues)}")
    if issues:
        print(f"\n  问题清单:")
        for i, iss in enumerate(issues, 1):
            print(f"    {i}. {iss.strip()}")
    print(f"\n{SEP}\n")

    conn.close()
    return 1 if issues else 0


def main():
    parser = argparse.ArgumentParser(description="测试数据库内用户与 Agent 的联通情况")
    parser.add_argument("--db-url", default=DEFAULT_DB_URL, help="PostgreSQL 连接串")
    args = parser.parse_args()
    return run(args.db_url)


if __name__ == "__main__":
    raise SystemExit(main())
