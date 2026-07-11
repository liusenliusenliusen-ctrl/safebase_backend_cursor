import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { requireUser } from "../auth/middleware.js";
import { query } from "../db.js";
import {
  assertChatProviderConfigured,
  assertEmbeddingConfigured,
  buildChatStreamRequestBody,
  getChatCompletionsUrl,
  getChatStreamHeaders,
  getLlmChatProvider,
} from "../llm/openrouter.js";
import { resolveChatModel } from "./model-router.js";
import {
  buildChatMessages,
  ensureDefaultProfile,
  extractLastUserMessage,
  insertAssistantMessage,
  updateUserMessageEmbedding,
} from "./memory.js";

function deltaContentToString(delta: { content?: unknown } | undefined): string {
  const c = delta?.content;
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p: unknown) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && "text" in (p as Record<string, unknown>)) {
          return String((p as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return String(c);
}

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { messages?: { role: string; content: string }[]; user_message_id?: number };
  }>("/api/chat/stream", { preHandler: requireUser }, async (request, reply) => {
    const userId = request.userId!;
    const userMessageId = request.body?.user_message_id;
    if (userMessageId == null || !Number.isFinite(userMessageId)) {
      return reply.code(400).send({ detail: "Missing user_message_id" });
    }

    const userMessage = extractLastUserMessage(request.body?.messages ?? []);
    if (!userMessage) {
      return reply.code(400).send({ detail: "Missing user message" });
    }

    try {
      assertEmbeddingConfigured();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ detail: msg });
    }

    try {
      assertChatProviderConfigured();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ detail: msg });
    }

    const owned = await query(
      `SELECT 1 FROM public.messages
       WHERE id = $1 AND user_id = $2::uuid AND role = 'user'`,
      [userMessageId, userId]
    );
    if (owned.rowCount === 0) {
      return reply.code(404).send({ detail: "User message not found" });
    }

    try {
      await ensureDefaultProfile(userId);
      const embeddingOk = await updateUserMessageEmbedding(
        userId,
        userMessageId,
        userMessage
      );
      if (!embeddingOk) {
        return reply.code(499).send({ detail: "cancelled" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(502).send({ detail: `Prepare user message failed: ${msg}` });
    }

    const modelChoice = resolveChatModel(userMessage);

    let chatMessages: { system: string; user: string };
    try {
      chatMessages = await buildChatMessages(userId, userMessage, {
        useIntakeTask: modelChoice.useIntakeTask,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(502).send({ detail: `RAG context failed: ${msg}` });
    }

    request.log.info(
      {
        userId,
        userMessageId,
        route: modelChoice.route,
        promptMode: modelChoice.promptMode,
        chatProvider: getLlmChatProvider(),
        routeReason: modelChoice.reason,
        model: modelChoice.model,
        maxTokens: modelChoice.maxTokens,
        useIntakeTask: modelChoice.useIntakeTask,
        temperature: modelChoice.reasoning
          ? undefined
          : config.openrouterChatTemperature,
        reasoningEnabled: modelChoice.reasoning,
        reasoningEffort: modelChoice.reasoning
          ? config.openrouterChatReasoningEffort
          : undefined,
        userMessage,
        systemPrompt: chatMessages.system,
        userPrompt: chatMessages.user,
      },
      "chat stream: model and prompt"
    );

    const upstreamRes = await fetch(getChatCompletionsUrl(), {
      method: "POST",
      headers: getChatStreamHeaders(),
      body: JSON.stringify(
        buildChatStreamRequestBody(
          [
            { role: "system", content: chatMessages.system },
            { role: "user", content: chatMessages.user },
          ],
          {
            model: modelChoice.model,
            reasoning: modelChoice.reasoning,
            maxTokens: modelChoice.maxTokens,
          }
        )
      ),
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      const t = await upstreamRes.text();
      return reply.code(upstreamRes.status).send(t);
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    });

    const decoder = new TextDecoder();
    const reader = upstreamRes.body.getReader();
    const parts: string[] = [];
    let carry = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });
        const blocks = carry.split("\n\n");
        carry = blocks.pop() ?? "";
        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload) as {
              choices?: { delta?: { content?: unknown } }[];
            };
            const piece = deltaContentToString(json.choices?.[0]?.delta);
            if (piece) {
              parts.push(piece);
              reply.raw.write(`data: ${piece}\n\n`);
            }
          } catch {
            /* skip */
          }
        }
      }

      const fullText = parts.join("");
      if (fullText.trim()) {
        try {
          await insertAssistantMessage(userId, fullText.trim());
        } catch (e) {
          request.log.error({ err: e }, "persist assistant message failed");
        }
      }
      reply.raw.write("event: end\n\n");
    } catch (e) {
      request.log.error({ err: e }, "chat stream failed");
    } finally {
      reply.raw.end();
    }

    return reply;
  });
}
