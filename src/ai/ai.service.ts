import { Inject, Injectable } from '@nestjs/common';
import { CreateAiDto } from './dto/create-ai.dto';
import { UpdateAiDto } from './dto/update-ai.dto';
import type { Runnable } from '@langchain/core/runnables';
import { PromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';

const database = {
  users: {
    '001': {
      id: '001',
      name: '张三',
      email: 'zhangsan@example.com',
      role: 'admin',
    },
    '002': { id: '002', name: '李四', email: 'lisi@example.com', role: 'user' },
    '003': {
      id: '003',
      name: '王五',
      email: 'wangwu@example.com',
      role: 'user',
    },
  },
};

const queryUserArgsSchema = z.object({
  userId: z.string().describe('用户 ID，例如: 001, 002, 003'),
});

type QueryUserArgs = {
  userId: string;
};

const queryUserTool = tool(
  async ({ userId }: QueryUserArgs) => {
    const user = database.users[userId];

    if (!user) {
      return `用户 ID ${userId} 不存在。可用的 ID: 001, 002, 003`;
    }

    return `用户信息：\n- ID: ${user.id}\n- 姓名: ${user.name}\n- 邮箱: ${user.email}\n- 角色: ${user.role}`;
  },
  {
    name: 'query_user',
    description:
      '查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。',
    schema: queryUserArgsSchema,
  },
);

@Injectable()
export class AiService {
  private readonly chain: Runnable;

  private readonly modelWithTools: Runnable<BaseMessage[], AIMessage>;

  constructor(@Inject('CHAT_MODEL') private readonly model: ChatOpenAI) {
    const prompt = PromptTemplate.fromTemplate('请回答一下问题: {query}');
    this.chain = prompt.pipe(model).pipe(new StringOutputParser());

    this.modelWithTools = model.bindTools([queryUserTool]);
  }

  async runChain(query: string): Promise<string> {
    const result = await this.chain.invoke({ query });
    return result;
  }

  async *streamChain(query: string): AsyncGenerator<string> {
    const stream = await this.chain.stream({ query });
    for await (const chunk of stream) {
      yield chunk;
    }
  }

  async runModelWithTools(query: string): Promise<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(
        '你是一个智能助手，可以在需要时调用工具（如 query_user）来查询用户信息，再用结果回答用户的问题。',
      ),
      new HumanMessage(query),
    ];

    // agent loop - 循环调用工具直到模型给出最终答案
    while (true) {
      const aiMessage = await this.modelWithTools.invoke(messages);
      messages.push(aiMessage);

      const toolCalls = aiMessage.tool_calls || [];
      if (toolCalls.length === 0) {
        // 没有工具调用，说明模型已经给出了最终答案
        return aiMessage.content as string;
      }

      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id || '';
        const toolName = toolCall.name;

        if (toolName === 'query_user') {
          const toolArgs = queryUserArgsSchema.parse(toolCall.args);
          const toolResult = await queryUserTool.invoke(toolArgs);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult,
            }),
          );
        }
      }
    }
  }

  async *runModelWithToolsStream(query: string): AsyncGenerator<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(
        '你是一个智能助手，可以在需要时调用工具（如 query_user）来查询用户信息，再用结果回答用户的问题。',
      ),
      new HumanMessage(query),
    ];

    while (true) {
      // 一轮对话：先让模型思考并（可能）提出工具调用
      const stream = await this.modelWithTools.stream(messages);
      let fullAiMessage: AIMessageChunk | null = null;

      for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
        // 使用 concat 方法将分块的 AIMessageChunk 合并为完整的 AIMessage
        if (!fullAiMessage) {
          fullAiMessage = chunk;
        } else {
          fullAiMessage = fullAiMessage.concat(chunk);
        }

        const hasToolCallChunk =
          !!fullAiMessage.tool_call_chunks &&
          fullAiMessage.tool_call_chunks.length > 0;

        if (!hasToolCallChunk) {
          // 如果没有工具调用，说明模型已经给出了最终答案
          yield fullAiMessage.content as string;
        }
      }

      if (!fullAiMessage) {
        return;
      }

      messages.push(fullAiMessage);

      const toolCalls = fullAiMessage.tool_call_chunks || [];
      // 没有工具调用：说明这一轮就是最终答案，已经在上面的 for-await-of 循环中处理了，可以结束
      if (toolCalls.length === 0) {
        return;
      }

      // 有工具调用：解析工具调用并执行，然后将结果加入消息列表，继续下一轮循环
      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id || '';
        const toolName = toolCall.name;

        if (toolName === 'query_user') {
          const toolArgs = queryUserArgsSchema.parse(toolCall.args);
          const toolResult = await queryUserTool.invoke(toolArgs);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult,
            }),
          );
        }
      }
    }
  }

  create(createAiDto: CreateAiDto) {
    return 'This action adds a new ai';
  }

  findAll() {
    return `This action returns all ai`;
  }

  findOne(id: number) {
    return `This action returns a #${id} ai`;
  }

  update(id: number, updateAiDto: UpdateAiDto) {
    return `This action updates a #${id} ai`;
  }

  remove(id: number) {
    return `This action removes a #${id} ai`;
  }
}
