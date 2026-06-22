import { tool } from "@langchain/core/tools";
import { Injectable } from "@nestjs/common";

@Injectable()
export class TimeNowToolService {
  readonly tool;

  constructor() {
    this.tool = tool(
      async () => {
        const now = new Date();
        return {
          iso: now.toISOString(),
          timestamp: now.getTime(),
        }
      },
      {
        name: 'time_now',
        description: '获取当前时间，返回 ISO 时间字符串和时间戳',
      }
    )
  }
}