import os
from typing import Optional
from src.config import settings


class LLMGateway:
    """Unified LLM gateway supporting multiple providers."""

    def __init__(self):
        self.providers = {}
        self._init_providers()

    def _init_providers(self):
        if settings.ANTHROPIC_API_KEY:
            self.providers["anthropic"] = {
                "api_key": settings.ANTHROPIC_API_KEY,
                "type": "anthropic",
            }
        if settings.OPENAI_API_KEY:
            self.providers["openai"] = {
                "api_key": settings.OPENAI_API_KEY,
                "type": "openai",
            }

    async def chat_completion(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        provider: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        system_prompt: Optional[str] = None,
    ) -> dict:
        model = model or settings.DEFAULT_LLM_MODEL
        provider = provider or self._select_provider(model)

        if provider == "anthropic" and "anthropic" in self.providers:
            return await self._call_anthropic(messages, model, temperature, max_tokens, system_prompt)
        elif provider == "openai" and "openai" in self.providers:
            return await self._call_openai(messages, model, temperature, max_tokens, system_prompt)
        else:
            # Fallback: echo response for development
            return await self._mock_response(messages)

    def _select_provider(self, model: str) -> str:
        if model.startswith("claude"):
            return "anthropic"
        elif model.startswith("gpt"):
            return "openai"
        return settings.DEFAULT_LLM_PROVIDER

    async def _call_anthropic(
        self, messages: list[dict], model: str, temperature: float, max_tokens: int, system_prompt: Optional[str]
    ) -> dict:
        try:
            import anthropic
            client = anthropic.AsyncAnthropic(api_key=self.providers["anthropic"]["api_key"])

            kwargs = {
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            if system_prompt:
                kwargs["system"] = system_prompt

            response = await client.messages.create(**kwargs)
            return {
                "content": response.content[0].text,
                "usage": {
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                },
                "model": model,
                "provider": "anthropic",
            }
        except Exception as e:
            # Fallback on error
            return await self._mock_response(messages)

    async def _call_openai(
        self, messages: list[dict], model: str, temperature: float, max_tokens: int, system_prompt: Optional[str]
    ) -> dict:
        try:
            import openai
            client = openai.AsyncOpenAI(api_key=self.providers["openai"]["api_key"])

            api_messages = []
            if system_prompt:
                api_messages.append({"role": "system", "content": system_prompt})
            api_messages.extend(messages)

            response = await client.chat.completions.create(
                model=model,
                messages=api_messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return {
                "content": response.choices[0].message.content,
                "usage": {
                    "input_tokens": response.usage.prompt_tokens,
                    "output_tokens": response.usage.completion_tokens,
                },
                "model": model,
                "provider": "openai",
            }
        except Exception as e:
            return await self._mock_response(messages)

    async def _mock_response(self, messages: list[dict]) -> dict:
        """Development fallback when no LLM provider is configured."""
        last_msg = messages[-1]["content"] if messages else ""
        return {
            "content": f"[Mock AI Response] 收到消息: {last_msg[:100]}",
            "usage": {"input_tokens": 0, "output_tokens": 0},
            "model": "mock",
            "provider": "mock",
        }


# Singleton
llm_gateway = LLMGateway()
