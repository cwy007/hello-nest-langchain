import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Sse, Res, BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';
import { CreateAiDto } from './dto/create-ai.dto';
import { UpdateAiDto } from './dto/update-ai.dto';
import { from, map } from 'rxjs';
import type { Response } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AI_TTS_STREAM_EVENT, type AiTtsStreamEvent } from 'src/common/stream-events';
import { pipeUIMessageStreamToResponse, UIMessage } from 'ai';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly eventEmitter: EventEmitter2,
  ) { }

  /**
   * AGUI
   curl -N -sS -X POST 'http://localhost:3000/ai/agent-chat' \
      -H 'Content-Type: application/json' \
      -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"上海今天的天气"}]}]}'
   */
  @Post('agent-chat')
  async agentChat(
    @Body() body: { messages?: UIMessage[]; },
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    if (!body?.messages || !Array.isArray(body.messages)) {
      throw new BadRequestException('Invalid JSON');
    }

    const stream = await this.aiService.runAgentStream(body.messages);
    pipeUIMessageStreamToResponse({ response: res, stream });
  }

  @Get('chat')
  async chat(@Query('query') query: string) {
    const answer = await this.aiService.runChain(query);
    return { answer };
  }

  @Sse('chat/stream')
  streamChat(
    @Query('query') query: string,
    @Query('ttsSessionId') ttsSessionId: string,
  ) {
    const sessionId = ttsSessionId?.trim();
    if (sessionId) {
      const startEvent: AiTtsStreamEvent = { type: 'start', sessionId, query };
      this.eventEmitter.emit(AI_TTS_STREAM_EVENT, startEvent);
    }

    return from(this.aiService.streamChain(query, sessionId)).pipe(
      map((chunk) => {
        console.log('Received chunk:', chunk);
        return { data: chunk };
      }),
    );
  }

  @Get('chat-with-tools')
  async chatWithTools(@Query('query') query: string) {
    const answer = await this.aiService.runModelWithTools(query);
    return { answer };
  }

  @Sse('chat-with-tools/stream')
  streamChatWithTools(@Query('query') query: string) {
    const stream = this.aiService.runModelWithToolsStream(query);
    return from(stream).pipe(
      map((chunk) => {
        console.log('chat-with-tools/stream Received chunk:', chunk);
        return { data: chunk };
      }),
    );
  }

  @Post()
  create(@Body() createAiDto: CreateAiDto) {
    return this.aiService.create(createAiDto);
  }

  @Get()
  findAll() {
    return this.aiService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.aiService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateAiDto: UpdateAiDto) {
    return this.aiService.update(+id, updateAiDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.aiService.remove(+id);
  }
}
