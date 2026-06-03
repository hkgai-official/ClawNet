#!/usr/bin/env python3
"""
以 Agent 身份给用户发消息。

从数据库读取 agent_session_keys 获取 agent_id 和 conversation_id，
通过 ClawNet 内部 API 以 Agent 身份发送消息，走完整链路：
  写入数据库 → WebSocket 通知前端 → 用户在页面上看到

认证方式: X-API-Key（不需要用户密码）

支持两种发送模式：
  1. 普通模式：一次性发送完整消息
  2. 流式模式：模拟 AI 逐字输出，前端实时显示

用法:
  # 列出所有 session key
  python tests/test_session_key_chat.py --list

  # 以第一条记录的 Agent 身份发消息
  python tests/test_session_key_chat.py -m "你好，我是你的助手"

  # 流式发送（模拟 AI 逐字输出）
  python tests/test_session_key_chat.py -m "你好，我是你的助手" --stream

  python tests/test_session_key_chat.py -m ## 张三的近期工作内容：

### 近几日工作重点：
1. **策略回测优化** - 针对高波动市场环境，调整T+0策略的滑点参数，基于三年历史数据进行重新回测，重点关注策略的回撤表现
2. **数据库故障排查** - 处理行情数据接口偶发性丢包问题，确保生产环境的实时行情推送延迟控制在毫秒级以内
3. **需求对接与翻译** - 将业务部门需求转化为具体的技术规格文档

---

这个信息与之前几次查询的结果基本一致。看起来跨助手协作功能已经稳定运行了多次测试。

需要我继续测试其他场景（比如询问王五的工作内容），或者我们可以开始处理你的实际工作任务了？" --stream

  # 流式发送，自定义发送间隔（毫秒）
  python tests/test_session_key_chat.py -m "你好，我是你的助手" --stream --stream-delay 100

  # 交互模式
  python tests/test_session_key_chat.py -i

  # 交互模式 + 流式发送
  python tests/test_session_key_chat.py -i --stream

  # 指定记录索引（从 --list 中选）
  python tests/test_session_key_chat.py --index 0 -m "你好"

  # 自定义后端地址和 API Key
  python tests/test_session_key_chat.py --backend-url http://localhost:9000 --api-key mykey -m "你好"
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import uuid
from typing import Any

import psycopg2
import requests


# ============ 数据库读取 ============

DEFAULT_DB_URL = "postgresql://clawnet:clawnet@localhost:5432/clawnet"
DEFAULT_BACKEND_URL = "http://localhost:9000"
DEFAULT_API_KEY = "clawnet-internal-key-change-in-production"


def fetch_session_keys(db_url: str, user_id: str | None = None) -> list[dict]:
    """从 agent_session_keys 表读取记录。"""
    conn = psycopg2.connect(db_url)
    try:
        cur = conn.cursor()
        if user_id:
            cur.execute(
                """
                SELECT sk.user_id, sk.agent_id, sk.session_key,
                       sk.gateway_ws_url, sk.gateway_token, sk.updated_at,
                       u.display_name AS user_name, u.email AS user_email,
                       a.display_name AS agent_name
                FROM agent_session_keys sk
                LEFT JOIN users u ON u.id = sk.user_id
                LEFT JOIN agents a ON a.id = sk.agent_id
                WHERE sk.user_id = %s::uuid
                ORDER BY sk.updated_at DESC
                """,
                (user_id,),
            )
        else:
            cur.execute(
                """
                SELECT sk.user_id, sk.agent_id, sk.session_key,
                       sk.gateway_ws_url, sk.gateway_token, sk.updated_at,
                       u.display_name AS user_name, u.email AS user_email,
                       a.display_name AS agent_name
                FROM agent_session_keys sk
                LEFT JOIN users u ON u.id = sk.user_id
                LEFT JOIN agents a ON a.id = sk.agent_id
                ORDER BY sk.updated_at DESC
                """
            )
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in rows]
    finally:
        conn.close()


def extract_conv_id(session_key: str) -> str | None:
    """从 session_key 提取 conversation_id（格式: clawnet:{conv_id}）。"""
    if session_key.startswith("clawnet:"):
        return session_key[len("clawnet:"):]
    return None


def print_session_keys(records: list[dict]) -> None:
    if not records:
        print("(空) 数据库中没有 session key 记录。")
        return
    print(f"\n{'='*80}")
    print(f"  共 {len(records)} 条记录")
    print(f"{'='*80}")
    for i, r in enumerate(records):
        conv_id = extract_conv_id(r['session_key']) or '?'
        print(f"\n  [{i}] Agent「{r.get('agent_name', '?')}」-> 用户「{r.get('user_name', '?')}」")
        print(f"      agent_id:  {r['agent_id']}")
        print(f"      user_id:   {r['user_id']}")
        print(f"      conv_id:   {conv_id}")
        print(f"      更新时间:  {r['updated_at']}")
    print(f"\n{'='*80}\n")


# ============ 内部 API 调用 ============

def send_as_agent(
    backend_url: str,
    api_key: str,
    agent_id: str,
    conversation_id: str,
    content: str,
) -> dict:
    """以 Agent 身份通过内部 API 发送消息（普通模式）。"""
    resp = requests.post(
        f"{backend_url}/api/internal/agent/send",
        headers={"X-API-Key": api_key},
        json={
            "agent_id": agent_id,
            "conversation_id": conversation_id,
            "content": content,
        },
    )
    if resp.status_code != 200:
        detail = resp.json().get("detail", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
        raise RuntimeError(f"HTTP {resp.status_code}: {detail}")
    return resp.json()


# ============ 流式发送 API ============

def stream_start(
    backend_url: str,
    api_key: str,
    agent_id: str,
    conversation_id: str,
) -> dict:
    """开始流式发送。"""
    resp = requests.post(
        f"{backend_url}/api/internal/agent/stream/start",
        headers={"X-API-Key": api_key},
        json={
            "agent_id": agent_id,
            "conversation_id": conversation_id,
        },
    )
    if resp.status_code != 200:
        detail = resp.json().get("detail", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
        raise RuntimeError(f"HTTP {resp.status_code}: {detail}")
    return resp.json()


def stream_delta(
    backend_url: str,
    api_key: str,
    stream_id: str,
    delta: str,
) -> dict:
    """发送流式增量。"""
    resp = requests.post(
        f"{backend_url}/api/internal/agent/stream/delta",
        headers={"X-API-Key": api_key},
        json={
            "stream_id": stream_id,
            "delta": delta,
        },
    )
    if resp.status_code != 200:
        detail = resp.json().get("detail", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
        raise RuntimeError(f"HTTP {resp.status_code}: {detail}")
    return resp.json()


def stream_end(
    backend_url: str,
    api_key: str,
    stream_id: str,
    save_to_db: bool = True,
) -> dict:
    """结束流式发送。"""
    resp = requests.post(
        f"{backend_url}/api/internal/agent/stream/end",
        headers={"X-API-Key": api_key},
        json={
            "stream_id": stream_id,
            "save_to_db": save_to_db,
        },
    )
    if resp.status_code != 200:
        detail = resp.json().get("detail", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
        raise RuntimeError(f"HTTP {resp.status_code}: {detail}")
    return resp.json()


def send_as_agent_streaming(
    backend_url: str,
    api_key: str,
    agent_id: str,
    conversation_id: str,
    content: str,
    delay_ms: int = 50,
    chunk_size: int = 1,
    verbose: bool = False,
) -> dict:
    """以 Agent 身份通过内部 API 发送消息（流式模式）。
    
    Args:
        backend_url: 后端地址
        api_key: API Key
        agent_id: Agent ID
        conversation_id: 会话 ID
        content: 要发送的完整内容
        delay_ms: 每个增量之间的延迟（毫秒）
        chunk_size: 每次发送的字符数
        verbose: 是否打印发送进度
    """
    # 1. 开始流式
    start_result = stream_start(backend_url, api_key, agent_id, conversation_id)
    stream_id = start_result["stream_id"]
    
    if verbose:
        print(f"  [流式开始] stream_id={stream_id[:16]}...")
    
    try:
        # 2. 逐字发送
        delay_sec = delay_ms / 1000.0
        sent = 0
        
        for i in range(0, len(content), chunk_size):
            chunk = content[i:i + chunk_size]
            stream_delta(backend_url, api_key, stream_id, chunk)
            sent += len(chunk)
            
            if verbose:
                # 打印进度（不换行）
                progress = sent / len(content) * 100
                print(f"\r  [发送中] {sent}/{len(content)} ({progress:.0f}%) ", end="", flush=True)
            
            time.sleep(delay_sec)
        
        if verbose:
            print()  # 换行
        
        # 3. 结束流式
        end_result = stream_end(backend_url, api_key, stream_id, save_to_db=True)
        
        if verbose:
            print(f"  [流式完成] message_id={end_result.get('message_id', '?')[:16] if end_result.get('message_id') else 'N/A'}...")
        
        return {
            "ok": True,
            "stream_id": stream_id,
            "message_id": end_result.get("message_id"),
            "final_text_length": end_result.get("final_text_length"),
        }
        
    except Exception as e:
        # 发生错误时尝试结束流式（不保存）
        try:
            stream_end(backend_url, api_key, stream_id, save_to_db=False)
        except:
            pass
        raise e


# ============ 主程序 ============

async def run(args: argparse.Namespace) -> int:
    records = fetch_session_keys(args.db_url, args.user_id)

    if args.list:
        print_session_keys(records)
        return 0

    if not records:
        print("数据库中没有 session key 记录。请先通过前端给 Agent 发一条消息。")
        return 1

    # 选择记录
    record = None
    if args.session_key:
        for r in records:
            if r["session_key"] == args.session_key:
                record = r
                break
        if not record:
            print(f"未找到 session_key={args.session_key}")
            print_session_keys(records)
            return 1
    elif args.index is not None:
        if 0 <= args.index < len(records):
            record = records[args.index]
        else:
            print(f"索引 {args.index} 超出范围 (0-{len(records)-1})")
            return 1
    else:
        record = records[0]

    agent_id = str(record["agent_id"])
    conv_id = extract_conv_id(record["session_key"])
    if not conv_id:
        print(f"无法解析 conversation_id: {record['session_key']}")
        return 1

    print(f"\n以 Agent 身份发送消息")
    print(f"  Agent:    {record.get('agent_name', '?')} ({agent_id[:8]}...)")
    print(f"  目标用户: {record.get('user_name', '?')}")
    print(f"  会话:     {conv_id[:8]}...")
    print(f"  后端:     {args.backend_url}")

    # 发送模式提示
    mode_hint = "流式" if args.stream else "普通"
    
    if args.interactive:
        print(f"\n[交互模式] 以 Agent「{record.get('agent_name', '?')}」身份发消息")
        print(f"[交互模式] 发送模式: {mode_hint}")
        if args.stream:
            print(f"[交互模式] 流式延迟: {args.stream_delay}ms，块大小: {args.chunk_size}字符")
        print(f"[交互模式] 用户会在前端页面看到这些消息")
        print(f"[交互模式] 输入 quit 退出\n")

        while True:
            try:
                line = input(f"[{record.get('agent_name', 'Agent')}] >> ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\n[退出]")
                break
            if not line:
                continue
            if line.lower() in ("quit", "exit", "q"):
                print("[退出]")
                break
            try:
                if args.stream:
                    result = send_as_agent_streaming(
                        args.backend_url, args.api_key, agent_id, conv_id, line,
                        delay_ms=args.stream_delay,
                        chunk_size=args.chunk_size,
                        verbose=True,
                    )
                    msg_id = result.get('message_id', '?')
                    print(f"  ✓ 流式发送完成 (message_id={(msg_id[:8] + '...') if msg_id and msg_id != '?' else 'N/A'})")
                else:
                    result = send_as_agent(args.backend_url, args.api_key, agent_id, conv_id, line)
                    print(f"  ✓ 已发送 (message_id={result.get('message_id', '?')[:8]}...)")
            except Exception as e:
                print(f"  ✗ 发送失败: {e}")

    elif args.message:
        print(f"\n[发送模式] {mode_hint}")
        print(f"[发送] {args.message}")
        try:
            if args.stream:
                result = send_as_agent_streaming(
                    args.backend_url, args.api_key, agent_id, conv_id, args.message,
                    delay_ms=args.stream_delay,
                    chunk_size=args.chunk_size,
                    verbose=True,
                )
                msg_id = result.get('message_id')
                print(f"[成功] 流式发送完成 message_id={msg_id if msg_id else 'N/A'}")
            else:
                result = send_as_agent(args.backend_url, args.api_key, agent_id, conv_id, args.message)
                print(f"[成功] message_id={result.get('message_id', '?')}")
            print(f"[提示] 用户「{record.get('user_name', '?')}」现在可以在前端页面看到这条消息了")
        except Exception as e:
            print(f"[错误] {e}")
            return 1
    else:
        print("\n请指定 --message 或 --interactive")
        return 1

    return 0


def main():
    parser = argparse.ArgumentParser(
        description="以 Agent 身份给用户发消息（通过 ClawNet 内部 API）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 列出所有 session key
  python tests/test_session_key_chat.py --list

  # 普通发送
  python tests/test_session_key_chat.py -m "你好，我是你的助手"

  # 流式发送（模拟 AI 逐字输出）
  python tests/test_session_key_chat.py -m "你好，我是你的助手" --stream

  # 流式发送，自定义延迟和块大小
  python tests/test_session_key_chat.py -m "你好" --stream --stream-delay 100 --chunk-size 2

  # 交互模式
  python tests/test_session_key_chat.py -i

  # 交互模式 + 流式
  python tests/test_session_key_chat.py -i --stream

  # 指定记录索引
  python tests/test_session_key_chat.py --index 1 -m "你好"
        """,
    )
    # 连接配置
    parser.add_argument("--db-url", default=DEFAULT_DB_URL, help="PostgreSQL 连接串")
    parser.add_argument("--backend-url", default=DEFAULT_BACKEND_URL, help="ClawNet 后端地址")
    parser.add_argument("--api-key", default=DEFAULT_API_KEY, help="内部 API Key")

    # 会话选择
    parser.add_argument("--user-id", default=None, help="按 user_id 过滤")
    parser.add_argument("--session-key", default=None, help="指定 session_key")
    parser.add_argument("--index", type=int, default=None, help="指定记录索引")

    # 发送模式
    parser.add_argument("--message", "-m", default=None, help="要发送的消息内容")
    parser.add_argument("--interactive", "-i", action="store_true", help="交互模式")
    parser.add_argument("--list", "-l", action="store_true", help="列出所有 session key")

    # 流式发送选项
    parser.add_argument("--stream", "-s", action="store_true", help="启用流式发送模式")
    parser.add_argument("--stream-delay", type=int, default=50, help="流式发送每个增量的延迟（毫秒，默认 50）")
    parser.add_argument("--chunk-size", type=int, default=1, help="流式发送每次发送的字符数（默认 1）")

    args = parser.parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
