import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Sse, Res } from '@nestjs/common';
import { AiService } from './ai.service';
import { CreateAiDto } from './dto/create-ai.dto';
import { UpdateAiDto } from './dto/update-ai.dto';
import { from, map } from 'rxjs';
import type { Response } from 'express';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) { }

  @Get('chat')
  async chat(@Query('query') query: string) {
    const answer = await this.aiService.runChain(query);
    return { answer };
  }

  @Sse('chat/stream')
  streamChat(@Query('query') query: string) {
    return from(this.aiService.streamChain(query)).pipe(
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
    const stream = this.aiService.runModelWithTools(query);
    return from(stream).pipe(
      map((chunk) => {
        console.log('Received chunk:', chunk);
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
