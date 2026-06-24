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
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AI_TTS_STREAM_EVENT,
  AiTtsStreamEvent,
} from 'src/common/stream-events';
import { createAgent } from 'langchain';
import { UIMessage } from 'ai';
import { toBaseMessages, toUIMessageStream } from '@ai-sdk/langchain'

const queryUserArgsSchema = z.object({
  userId: z.string().describe('用户 ID，例如: 001, 002, 003'),
});

@Injectable()
export class AiService {
  private readonly chain: Runnable;

  private readonly modelWithTools: Runnable<BaseMessage[], AIMessage>;

  private readonly agent: ReturnType<typeof createAgent>;

  constructor(
    @Inject('CHAT_MODEL') private readonly model: ChatOpenAI,
    @Inject('QUERY_USER_TOOL') private readonly queryUserTool: any,
    @Inject('SEND_MAIL_TOOL') private readonly sendMailTool: any,
    @Inject('WEB_SEARCH_TOOL') private readonly webSearchTool: any,
    @Inject('DB_USERS_CRUD_TOOL') private readonly dbUsersCrudTool: any,
    @Inject('CRON_JOB_TOOL') private readonly cronJobTool: any,
    @Inject('TIME_NOW_TOOL') private readonly timeNowTool: any,
    private readonly eventEmitter: EventEmitter2,
  ) {
    const prompt = PromptTemplate.fromTemplate('请回答一下问题: {query}');
    this.chain = prompt.pipe(model).pipe(new StringOutputParser());

    this.modelWithTools = model.bindTools([
      this.queryUserTool,
      this.sendMailTool,
      this.webSearchTool,
      this.dbUsersCrudTool,
      this.cronJobTool,
      this.timeNowTool,
    ]);

    // createAgent 不用自己写 agent loop，内部会自动循环调用工具直到模型给出最终答案
    this.agent = createAgent({
      model: model,
      tools: [
        this.webSearchTool,
      ],
      systemPrompt: `你是 AI 助手，需要最新信息、事实核查或联网信息时，请使用 web_search 工具搜索后再作答。`,
    });
  }

  async runAgentStream(messages: UIMessage[]) {
    const lcMessages = await toBaseMessages(messages);
    const lgStream = await this.agent.stream(
      { messages: lcMessages },
      {
        streamMode: ['messages', 'values'],
        recursionLimit: 12,
      }
    );
    return toUIMessageStream(lgStream as AsyncIterable<AIMessageChunk>);
  }

  async runChain(query: string): Promise<string> {
    const result = await this.chain.invoke({ query });
    return result;
  }

  async *streamChain(
    query: string,
    ttsSessionId?: string,
  ): AsyncGenerator<string> {
    const stream = await this.chain.stream({ query });
    for await (const chunk of stream) {
      if (ttsSessionId) {
        const streamEvent: AiTtsStreamEvent = {
          type: 'chunk',
          sessionId: ttsSessionId,
          chunk,
        };
        this.eventEmitter.emit(AI_TTS_STREAM_EVENT, streamEvent);
      }
      yield chunk;
    }
  }

  async runModelWithTools(query: string): Promise<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(
        `你是一个通用任务助手，可以根据用户的目标规划步骤，并在需要时调用工具：\`query_user\` 查询或校验用户信息、\`send_mail\` 发送邮件、\`web_search\` 进行互联网搜索、\`db_users_crud\` 读写数据库 users 表、\`cron_job\` 创建和管理定时/周期任务（\`list\`/\`add\`/\`toggle\`），从而实现提醒、定期任务、数据同步等各种自动化需求。

定时任务类型选择规则（非常重要）：
- 用户说“X分钟/小时/天后”“在某个时间点”“到点提醒”（一次性）=> 用 \`cron_job\` + \`type=at\`（执行一次后自动停用），\`at\`=当前时间+X 或解析出的时间点
- 用户说“每X分钟/每小时/每天”“定期/循环/一直”（重复执行）=> 用 \`cron_job\` + \`type=every\`（每次执行），\`everyMs\`=X换算成毫秒
- 用户给出 Cron 表达式或明确说“用 cron 表达式”（重复执行）=> 用 \`cron_job\` + \`type=cron\`

在调用 \`cron_job.add\` 创建任务时，需要把用户原始自然语言拆成两部分：一部分是“什么时候执行”（用来决定 type/at/everyMs/cron），另一部分是“要做什么任务本身”。\`instruction\` 字段只能填“要做什么”的那部分文本（保持原语言和原话），不能再改写、翻译或总结。

当用户请求“在未来某个时间点执行某个动作”（例如“1分钟后给我发一个笑话到邮箱”）时，本轮对话只需要使用 \`cron_job\` 设置/更新定时任务，不要在当前轮直接完成这个动作本身：不要直接调用 \`send_mail\` 给他发邮件，也不要在当前轮就真正“执行”指令，只需把要执行的动作写进 \`instruction\` 里，交给将来的定时任务去跑。

注意：像“\`1分钟后提醒我喝水\`”，时间相关信息用于计算下一次执行时间，而 \`instruction\` 应该是“提醒我喝水”；本轮不需要立刻提醒。`,
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
        console.log('Processing tool call:', {
          name: toolCall.name,
          args: toolCall.args,
        });
        const toolCallId = toolCall.id || '';
        const toolName = toolCall.name;

        if (toolName === 'query_user') {
          const toolArgs = queryUserArgsSchema.parse(toolCall.args);
          const toolResult = await this.queryUserTool.invoke(toolArgs);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult,
            }),
          );
        } else if (toolName === 'send_mail') {
          const toolResult = await this.sendMailTool.invoke(toolCall.args);
          console.log('Tool result:', toolResult);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult,
            }),
          );
        } else if (toolName === 'web_search') {
          const toolResult = await this.webSearchTool.invoke(
            typeof toolCall.args === 'string'
              ? JSON.parse(toolCall.args)
              : toolCall.args,
          );
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult,
            }),
          );
        } else if (toolName === 'db_users_crud') {
          const toolResult = await this.dbUsersCrudTool.invoke(toolCall.args);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult,
            }),
          );
        } else if (toolName === 'cron_job') {
          const toolResult = await this.cronJobTool.invoke(toolCall.args);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult,
            }),
          );
        } else if (toolName === 'time_now') {
          const toolResult = await this.timeNowTool.invoke(toolCall.args);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult.iso,
            }),
          );
        }
      }
    }
  }

  async *runModelWithToolsStream(query: string): AsyncGenerator<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(
        `你是一个通用任务助手，可以根据用户的目标规划步骤，并在需要时调用工具：\`query_user\` 查询或校验用户信息、\`send_mail\` 发送邮件、\`web_search\` 进行互联网搜索、\`db_users_crud\` 读写数据库 users 表、\`cron_job\` 创建和管理定时/周期任务（\`list\`/\`add\`/\`toggle\`）、\`time_now\` 获取当前时间，从而实现提醒、定期任务、数据同步等各种自动化需求。

定时任务类型选择规则（非常重要）：
- 用户说“X分钟/小时/天后”“在某个时间点”“到点提醒”（一次性）=> 用 \`cron_job\` + \`type=at\`（执行一次后自动停用），\`at\`=当前时间+X 或解析出的时间点
- 用户说“每X分钟/每小时/每天”“定期/循环/一直”（重复执行）=> 用 \`cron_job\` + \`type=every\`（每次执行），\`everyMs\`=X换算成毫秒
- 用户给出 Cron 表达式或明确说“用 cron 表达式”（重复执行）=> 用 \`cron_job\` + \`type=cron\`

在调用 \`cron_job.add\` 创建任务时，需要把用户原始自然语言拆成两部分：一部分是“什么时候执行”（用来决定 type/at/everyMs/cron），另一部分是“要做什么任务本身”。\`instruction\` 字段只能填“要做什么”的那部分文本（保持原语言和原话），不能再改写、翻译或总结。

当用户请求“在未来某个时间点执行某个动作”（例如“1分钟后给我发一个笑话到邮箱”）时，本轮对话只需要使用 \`cron_job\` 设置/更新定时任务，不要在当前轮直接完成这个动作本身：不要直接调用 \`send_mail\` 给他发邮件，也不要在当前轮就真正“执行”指令，只需把要执行的动作写进 \`instruction\` 里，交给将来的定时任务去跑。

注意：像“\`1分钟后提醒我喝水\`”，时间相关信息用于计算下一次执行时间，而 \`instruction\` 应该是“提醒我喝水”；本轮不需要立刻提醒。`,
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
          // yield fullAiMessage.content as string;
        }
        yield chunk.content as string;
      }

      if (!fullAiMessage) {
        yield '\n';
        return;
      }

      messages.push(fullAiMessage);

      const toolCalls = fullAiMessage.tool_call_chunks || [];
      console.log(
        'Tool calls:',
        toolCalls.map((tc) => ({ name: tc.name, args: tc.args })),
      );
      // 没有工具调用：说明这一轮就是最终答案，已经在上面的 for-await-of 循环中处理了，可以结束
      if (toolCalls.length === 0) {
        yield '\n';
        return;
      }

      // 有工具调用：解析工具调用并执行，然后将结果加入消息列表，继续下一轮循环
      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id || '';
        const toolName = toolCall.name;

        if (toolName === 'query_user') {
          const toolArgs = queryUserArgsSchema.parse(toolCall.args);
          const toolResult = await this.queryUserTool.invoke(toolArgs);
          console.log('Tool result:', toolResult);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult,
            }),
          );
        } else if (toolName === 'send_mail') {
          const toolResult = await this.sendMailTool.invoke(toolCall.args);
          console.log('Tool result:', toolResult);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult,
            }),
          );
        } else if (toolName === 'web_search') {
          const toolResult = await this.webSearchTool.invoke(
            typeof toolCall.args === 'string'
              ? JSON.parse(toolCall.args)
              : toolCall.args,
          );
          console.log('Tool result:', toolResult);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult,
            }),
          );
        } else if (toolName === 'db_users_crud') {
          const toolResult = await this.dbUsersCrudTool.invoke(
            typeof toolCall.args === 'string'
              ? JSON.parse(toolCall.args)
              : toolCall.args,
          );
          console.log('Tool result:', toolResult);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult,
            }),
          );
        } else if (toolName === 'cron_job') {
          const toolResult = await this.cronJobTool.invoke(
            typeof toolCall.args === 'string'
              ? JSON.parse(toolCall.args)
              : toolCall.args,
          );
          console.log('Tool result:', toolResult);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult,
            }),
          );
        } else if (toolName === 'time_now') {
          const toolResult = await this.timeNowTool.invoke(toolCall.args);
          console.log('Tool result:', toolResult);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: toolResult.iso,
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
